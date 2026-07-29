class HintsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._level1Selected = null;
    this._level2Opened = null;
    this._level3Selected = null;
    this._data = {};
  }

  setConfig(config) {
    this._config = config;
    this._title = config.title || "Gestion des indices";
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._loadData();
  }

  getCardSize() {
    return 5;
  }

  async _loadData() {
    if (!this._hass) return;
    try {
      const resp = await this._hass.callWS({
        type: "hints_manager/get_all",
      });
      this._data = resp || {};
    } catch (e) {
      // fallback : lecture via service + state si pas de websocket command custom
      console.warn("hints-card: impossible de charger via WS, fallback", e);
      this._data = this._data || {};
    }
    this._render();
  }

  _selectLevel1(value) {
    this._level1Selected = value;
    this._level2Opened = null;
    this._level3Selected = null;
    this._selectedContenue = null;
    this._render();

    if (this._hass) {
      await this._hass.callService("input_text", "set_value", {
        entity_id: "input_text.hints_selected_indice_index",
        value: "null",
      });
    }
  }

  _toggleLevel2(key) {
    if (this._level2Opened === key) {
      this._level2Opened = null;
    } else {
      this._level2Opened = key;
    }
    this._level3Selected = null;
    this._selectedContenue = null;
    this._render();

    if (this._hass) {
      await this._hass.callService("input_text", "set_value", {
        entity_id: "input_text.hints_selected_indice_index",
        value: "null",
      });
    }
  }

  async _selectLevel3(level2Key, level3Key, indexValue, contenue) {
    this._level3Selected = level3Key;
    this._render();

    // Met à jour l'input_text
    await this._hass.callService("input_text", "set_value", {
      entity_id: "input_text.hints_selected_indice_index",
      value: String(indexValue),
    });

    // Optionnel : appel service custom pour tracer la sélection côté backend
    if (this._hass.services["hints_manager"]?.select_indice) {
      await this._hass.callService("hints_manager", "select_indice", {
        level1: this._level1Selected,
        level2: level2Key,
        level3: level3Key,
      });
    }

    this._selectedContenue = contenue;
    this._render();
  }

  _render() {
    if (!this.shadowRoot) return;

    const level1Keys = Object.keys(this._data || {});
    const level2Data =
      this._level1Selected && this._data[this._level1Selected]
        ? this._data[this._level1Selected]
        : {};

    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          padding: 16px;
        }
        .card-title {
          font-size: 1.2em;
          font-weight: 500;
          margin-bottom: 12px;
          color: var(--primary-text-color);
        }
        select {
          width: 100%;
          padding: 8px;
          margin-bottom: 16px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-size: 1em;
        }
        .level2-block {
          margin-bottom: 8px;
        }
        .level2-btn {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 1em;
          font-weight: 500;
          transition: background 0.2s;
        }
        .level2-btn:hover {
          background: var(--divider-color);
        }
        .level2-btn.opened {
          background: var(--primary-color);
          color: var(--text-primary-color, white);
        }
        .chevron {
          transition: transform 0.2s;
          font-size: 0.9em;
        }
        .chevron.opened {
          transform: rotate(90deg);
        }
        .level3-stack {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px 0 8px 16px;
        }
        .level3-btn {
          padding: 8px 12px;
          background: var(--card-background-color);
          border: 1px solid var(--divider-color);
          border-radius: 6px;
          cursor: pointer;
          text-align: left;
          color: var(--primary-text-color);
          font-size: 0.95em;
          transition: background 0.2s;
        }
        .level3-btn:hover {
          background: var(--secondary-background-color);
        }
        .level3-btn.selected {
          background: var(--primary-color);
          color: var(--text-primary-color, white);
          border-color: var(--primary-color);
        }
        .content-box {
          margin-top: 16px;
          padding: 12px;
          background: var(--secondary-background-color);
          border-radius: 8px;
          height: 100px;
          overflow-y: auto;
          white-space: pre-wrap;
          color: var(--primary-text-color);
          font-size: 0.95em;
          line-height: 1.4;
        }
        .content-box.empty {
          color: var(--disabled-text-color);
          font-style: italic;
        }
        .empty-msg {
          color: var(--disabled-text-color);
          font-style: italic;
          padding: 8px;
        }
      </style>
      <ha-card>
        <div class="card-title">${this._title}</div>

        <select id="level1-select">
          <option value="" ${!this._level1Selected ? "selected" : ""}>-- Sélectionner --</option>
          ${level1Keys
            .map(
              (k) =>
                `<option value="${k}" ${this._level1Selected === k ? "selected" : ""}>${k}</option>`
            )
            .join("")}
        </select>

        <div id="level2-container">
          ${
            Object.keys(level2Data).length === 0
              ? `<div class="empty-msg">${this._level1Selected ? "Aucune sous-catégorie" : "Sélectionnez une énigme"}</div>`
              : Object.keys(level2Data)
                  .map((l2key) => this._renderLevel2Block(l2key, level2Data[l2key]))
                  .join("")
          }
        </div>

        <div class="content-box ${this._selectedContenue ? "" : "empty"}">
          ${this._selectedContenue || "Sélectionnez un indice pour afficher son contenu"}
        </div>
      </ha-card>
    `;

    this._attachEvents();
  }

  _renderLevel2Block(l2key, level3Data) {
    const isOpened = this._level2Opened === l2key;
    return `
      <div class="level2-block">
        <button class="level2-btn ${isOpened ? "opened" : ""}" data-l2key="${l2key}">
          <span>${l2key}</span>
          <span class="chevron ${isOpened ? "opened" : ""}">▶</span>
        </button>
        ${
          isOpened
            ? `<div class="level3-stack">
                ${Object.keys(level3Data)
                  .map((l3key) => {
                    const entry = level3Data[l3key];
                    const isSelected = this._level3Selected === l3key;
                    return `<button class="level3-btn ${isSelected ? "selected" : ""}"
                              data-l2key="${l2key}"
                              data-l3key="${l3key}"
                              data-index="${entry.index}"
                              data-contenue="${this._escapeHtml(entry.contenue || "")}">
                              ${l3key}
                            </button>`;
                  })
                  .join("")}
              </div>`
            : ""
        }
      </div>
    `;
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&')
      .replace(/"/g, '"')
      .replace(/</g, '<')
      .replace(/>/g, '>');
  }

  _attachEvents() {
    const select = this.shadowRoot.getElementById("level1-select");
    if (select) {
      select.addEventListener("change", (e) => {
        this._selectLevel1(e.target.value || null);
      });
    }

    this.shadowRoot.querySelectorAll(".level2-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this._toggleLevel2(e.currentTarget.dataset.l2key);
      });
    });

    this.shadowRoot.querySelectorAll(".level3-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const { l2key, l3key, index, contenue } = e.currentTarget.dataset;
        this._selectLevel3(l2key, l3key, index, contenue);
      });
    });
  }
}

customElements.define("hints-card", HintsCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "hints-card",
  name: "Hints Manager Card",
  description: "Carte de gestion des indices (3 niveaux) pour escape game",
});
