import voluptuous as vol
from homeassistant import config_entries

from .const import DOMAIN, DEFAULT_JSON_PATH


class HintsManagerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(
                title="Hints Manager", data=user_input
            )

        schema = vol.Schema({
            vol.Required("json_path", default=DEFAULT_JSON_PATH): str,
        })

        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    def async_get_options_flow(config_entry):
        return HintsManagerOptionsFlow(config_entry)


class HintsManagerOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry):
        self._config_entry = config_entry

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        def _get(key, default):
            return self._config_entry.options.get(
                key, self._config_entry.data.get(key, default)
            )

        schema = vol.Schema({
            vol.Required(
                "json_path", default=_get("json_path", DEFAULT_JSON_PATH)
            ): str,
        })

        return self.async_show_form(step_id="init", data_schema=schema)
