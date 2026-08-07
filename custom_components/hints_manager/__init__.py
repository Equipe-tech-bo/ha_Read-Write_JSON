import json
import logging
import os
import asyncio

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.config_entries import ConfigEntry
from homeassistant.components import websocket_api

from .const import DOMAIN, DEFAULT_JSON_PATH, INPUT_TEXT_SELECTED_INDEX

_LOGGER = logging.getLogger(__name__)

_write_queues: dict[str, asyncio.Queue] = {}


# ── UTILITAIRES JSON ──────────────────────────────────────────────────── #
async def _async_load_json(hass, path: str) -> dict:
    def _read():
        try:
            with open(path, "r") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
    return await hass.async_add_executor_job(_read)


async def _async_save_json(hass, path: str, data: dict):
    def _write():
        with open(path, "w") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    await hass.async_add_executor_job(_write)


async def _async_ensure_json_file(hass, path: str):
    def _ensure():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not os.path.exists(path):
            with open(path, "w") as f:
                json.dump({}, f, indent=4)
    await hass.async_add_executor_job(_ensure)


def _get_nested(d: dict, keys: list):
    for key in keys:
        if isinstance(d, dict) and key in d:
            d = d[key]
        else:
            return None
    return d


def _set_nested(d: dict, keys: list, value):
    for key in keys[:-1]:
        existing = d.get(key)
        if not isinstance(existing, dict):
            d[key] = {}
        d = d[key]
    d[keys[-1]] = value


def _delete_in_dict(data: dict, keys: list):
    if not keys:
        return
    key = keys[0]
    if len(keys) == 1:
        data.pop(key, None)
        return
    if key in data and isinstance(data[key], dict):
        _delete_in_dict(data[key], keys[1:])
        if not data[key]:
            data.pop(key, None)


def _clean_empty(node):
    if not isinstance(node, dict):
        if node is None or node == "":
            return None
        return node
    cleaned = {}
    for key, value in node.items():
        result = _clean_empty(value)
        if result is not None:
            cleaned[key] = result
    return cleaned if cleaned else None


# ── QUEUE D'ÉCRITURE SÉQUENTIELLE ──────────────────────────────────────── #
async def _json_writer(hass, json_path: str, queue: asyncio.Queue):
    while True:
        item = await queue.get()
        if item is None:
            queue.task_done()
            break
        parts, payload, future = item
        try:
            data = await _async_load_json(hass, json_path)
            if payload is None:
                _delete_in_dict(data, parts)
            else:
                _set_nested(data, parts, payload)
            cleaned = _clean_empty(data) or {}
            await _async_save_json(hass, json_path, cleaned)
            _LOGGER.debug(f"[HintsManager] Écrit [{'/'.join(parts)}] = {payload}")
            if future and not future.done():
                future.set_result(True)
        except Exception as e:
            _LOGGER.error(f"[HintsManager] Erreur écriture JSON : {e}")
            if future and not future.done():
                future.set_exception(e)
        finally:
            queue.task_done()


# ── WEBSOCKET COMMAND : hints_manager/get_all ──────────────────────────── #
@websocket_api.websocket_command({"type": "hints_manager/get_all"})
@websocket_api.async_response
async def ws_get_all(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict):
    """Renvoie l'intégralité du JSON pour la première entry configurée."""
    domain_data = hass.data.get(DOMAIN, {})

    entry_data = None
    for key, value in domain_data.items():
        if isinstance(value, dict) and "json_path" in value:
            entry_data = value
            break

    if entry_data is None:
        connection.send_error(msg["id"], "not_found", "Aucune configuration hints_manager active")
        return

    json_path = entry_data["json_path"]
    write_queue = entry_data["write_queue"]

    await write_queue.join()
    data = await _async_load_json(hass, json_path)
    connection.send_result(msg["id"], data)


# ── SETUP ───────────────────────────────────────────────────────────────── #
async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:

    json_path = (
        entry.options.get("json_path") or
        entry.data.get("json_path") or
        DEFAULT_JSON_PATH
    )
    if not json_path.startswith("/"):
        json_path = "/" + json_path

    _LOGGER.info(f"[HintsManager] JSON path : {json_path}")

    await _async_ensure_json_file(hass, json_path)

    write_queue = asyncio.Queue()
    _write_queues[entry.entry_id] = write_queue

    writer_task = hass.loop.create_task(
        _json_writer(hass, json_path, write_queue),
        name=f"hints_manager_writer_{entry.entry_id}"
    )

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {
        "json_path": json_path,
        "write_queue": write_queue,
        "writer_task": writer_task,
    }

    # ── Enregistrement de la WebSocket command (une seule fois, même si plusieurs entries) ── #
    if not hass.data[DOMAIN].get("_ws_registered"):
        websocket_api.async_register_command(hass, ws_get_all)
        hass.data[DOMAIN]["_ws_registered"] = True

    # ── SERVICE : get_tree (renvoie tout le JSON, utilisé par la carte) ── #
    async def handle_get_tree(call: ServiceCall):
        await write_queue.join()
        data = await _async_load_json(hass, json_path)
        return data

    hass.services.async_register(
        DOMAIN, "get_tree", handle_get_tree, supports_response="only"
    )

    # ── SERVICE : get_value (lecture à un chemin donné) ─────────────────── #
    async def handle_get_value(call: ServiceCall):
        level1 = call.data.get("level1", "").strip()
        level2 = call.data.get("level2", "").strip()
        level3 = call.data.get("level3", "").strip()
        parts = [p for p in [level1, level2, level3] if p]

        await write_queue.join()
        data = await _async_load_json(hass, json_path)
        value = _get_nested(data, parts)
        return {"value": value}

    hass.services.async_register(
        DOMAIN, "get_value", handle_get_value, supports_response="only"
    )

    # ── SERVICE : set_value (écriture à un chemin donné, avec nettoyage auto) ── #
    async def handle_set_value(call: ServiceCall):
        level1 = (call.data.get("level1") or "").strip()
        level2 = (call.data.get("level2") or "").strip()
        level3 = (call.data.get("level3") or "").strip()
        contenue = call.data.get("contenue", None)

        if not level1 or not level2 or not level3:
            return {"success": False, "error": "level1, level2 et level3 sont requis"}

        parts = [level1, level2, level3]

        # Cas suppression : contenue vide/None -> payload = None (le writer supprimera et nettoiera)
        if contenue is None or contenue == "":
            future = hass.loop.create_future()
            await write_queue.put((parts, None, future))
            try:
                await future
            except Exception as e:
                return {"success": False, "error": str(e)}

            await write_queue.join()
            data = await _async_load_json(hass, json_path)
            return {"success": True, "data": data}

        # Cas écriture : on doit connaître l'index existant ou en calculer un nouveau
        await write_queue.join()
        current_data = await _async_load_json(hass, json_path)

        existing_node = _get_nested(current_data, parts)
        if isinstance(existing_node, dict) and "index" in existing_node:
            index_value = existing_node["index"]
        else:
            level2_node = _get_nested(current_data, [level1, level2]) or {}
            existing_indexes = [
                v.get("index", -1) for v in level2_node.values() if isinstance(v, dict)
            ]
            index_value = (max(existing_indexes) + 1) if existing_indexes else 0

        payload = {"index": index_value, "contenue": contenue}

        future = hass.loop.create_future()
        await write_queue.put((parts, payload, future))
        try:
            await future
        except Exception as e:
            return {"success": False, "error": str(e)}

        await write_queue.join()
        data = await _async_load_json(hass, json_path)
        return {"success": True, "data": data}

    hass.services.async_register(
        DOMAIN, "set_value", handle_set_value, supports_response="only"
    )

    # ── SERVICE : select_indice (met à jour input_text + retourne le contenu) ── #
    async def handle_select_indice(call: ServiceCall):
        level1 = call.data.get("level1", "").strip()
        level2 = call.data.get("level2", "").strip()
        level3 = call.data.get("level3", "").strip()
        parts = [p for p in [level1, level2, level3] if p]

        await write_queue.join()
        data = await _async_load_json(hass, json_path)
        node = _get_nested(data, parts)

        if not isinstance(node, dict):
            _LOGGER.warning(f"[HintsManager] select_indice : chemin introuvable {parts}")
            return {"contenue": "", "index": ""}

        index_value = node.get("index", "")
        contenue_value = node.get("contenue", "")

        # Mise à jour de l'input_text dédié
        await hass.services.async_call(
            "input_text",
            "set_value",
            {
                "entity_id": INPUT_TEXT_SELECTED_INDEX,
                "value": str(index_value),
            },
            blocking=True,
        )

        _LOGGER.info(
            f"[HintsManager] Indice sélectionné {parts} → index={index_value}"
        )

        return {"contenue": contenue_value, "index": index_value}

    hass.services.async_register(
        DOMAIN, "select_indice", handle_select_indice, supports_response="only"
    )

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    entry_data = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if entry_data:
        await entry_data["write_queue"].put(None)
        await entry_data["writer_task"]

    hass.services.async_remove(DOMAIN, "get_tree")
    hass.services.async_remove(DOMAIN, "get_value")
    hass.services.async_remove(DOMAIN, "set_value")
    hass.services.async_remove(DOMAIN, "select_indice")
    return True
