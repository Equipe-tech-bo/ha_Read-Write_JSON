class HintsEditorCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._data = {};
      this._lastLoad = 0;
  
      this._level1Value = "";
      this._level2Value = "";
      this._level3Value = "";
      this._contenueValue = "";
  
      this._originalContenue = null; // pour savoir si l'indice existait déjà
    }
  
    setConfig(config) {
      this._config = config;
      this._title = config.title || "Éditeur d'indices";
      this._render();
    }
  
    set hass(hass) {
      this._hass = hass;
      const now = Date.now();
      if (!this._lastLoad || now - this._lastLoad > 3000) {
        this._lastLoad = now;
        this._loadData();
      }
    }
  
    getCardSize() {
      return 6;
    }
  
    async _loadData() {
      if (!this._hass) return;
      try {
        const resp = await this._hass.callWS({ type: "hints_manager/get_all" });
        const newDataStr = JSON.stringify(resp || {});
        const oldDataStr = JSON.stringify(this._data || {});
        if (newDataStr !== oldDataStr) {
          this._data = resp || {};
          this._render();
        }
      } catch (e) {
        console.warn("hints-editor-card: impossible de charger via WS", e);
      }
    }
  
    // ── Listes de suggestions calculées dynamiquement ──
    _getLevel1Options() {
      return Object.keys(this._data || {});
    }
  
    _getLevel2Options() {
      const l1 = this._data[this._level1Value];
      return l1 ? Object.keys(l1) : [];
    }
  
    _getLevel3Options() {
      const l1 = this._data[this._level1Value];
      const l2 = l1 ? l1[this._level2Value] : null;
      return l2 ? Object.keys(l2) : [];
    }
  
    _getExistingContenue() {
      const l1 = this._data[this._level1Value];
      const l2 = l1 ? l1[this._level2Value] : null;
      const l3 = l2 ? l2[this._level3Value] : null;
      return l3 ? l3.contenue : null;
    }
  
    // ── Handlers de saisie ──
    _onLevel1Input(value) {
      this._level1Value = value;
      this._level2Value = "";
      this._level3Value = "";
      this._contenueValue = "";
      this._originalContenue = null;
      this._render();
    }
  
    _onLevel2Input(value) {
      this._level2Value = value;
      this._level3Value = "";
      this._contenueValue = "";
      this._originalContenue = null;
      this._render();
    }
  
    _onLevel3Input(value) {
      this._level3Value = value;
      const existing = this._getExistingContenue();
      this._originalContenue = existing;
      this._contenueValue = existing !== null ? existing : "";
      this._render();
    }
  
    _onContenueInput(value) {
      this._contenueValue = value;
      // Pas de _render() ici pour ne pas perdre le focus du textarea à chaque frappe
    }
  
    async _onValidate() {
      const level1 = (this._level1Value || "").trim();
      const level2 = (this._level2Value || "").trim();
      const level3 = (this._level3Value || "").trim();
      const contenue = (this._contenueValue || "").trim();
  
      if (!level1 || !level2 || !level3) {
        this._showFeedback("Veuillez remplir les 3 niveaux (énigme / sous-catégorie / indice).", true);
        return;
      }
  
      try {
        const resp = await this._hass.callService(
          "hints_manager",
          "set_value",
          { level1, level2, level3, contenue },
          undefined,
          true,
          true // return_response
        );
  
        if (resp?.response?.success) {
          this._showFeedback(
            contenue === "" ? "Indice supprimé." : "Indice enregistré."
          );
          // Recharge immédiate des données (bypass throttle)
          this._lastLoad = 0;
          await this._loadData();
  
          if (contenue === "") {
            // Reset complet si suppression
            this._level1Value = "";
            this._level2Value = "";
            this._level3Value = "";
            this._contenueValue = "";
            this._originalContenue = null;
          }
          this._render();
        } else {
          this._showFeedback(resp?.response?.error || "Erreur inconnue.", true);
        }
      } catch (e) {
        console.error("hints-editor-card: erreur set_value", e);
        this._showFeedback("Erreur lors de l'enregistrement.", true);
      }
    }
  
    _showFeedback(msg, isError = false) {
      this._feedbackMsg = msg;
      this._feedbackError = isError;
      this._render();
      clearTimeout(this._feedbackTimeout);
      this._feedbackTimeout = setTimeout(() => {
        this._feedbackMsg = null;
        this._render();
      }, 4000);
    }
  
    _render() {
      if (!this.shadowRoot) return;
  
      // Préserve le focus / la position du curseur du textarea si actif
      const activeIsTextarea =
        this.shadowRoot.activeElement?.id === "contenue-textarea";
      const cursorPos = activeIsTextarea
        ? this.shadowRoot.getElementById("contenue-textarea").selectionStart
        : null;
  
      const level1Options = this._getLevel1Options();
      const level2Options = this._getLevel2Options();
      const level3Options = this._getLevel3Options();
  
      const isNewIndice =
        this._level3Value && this._originalContenue === null;
  
      this.shadowRoot.innerHTML = `
        <style>
          ha-card { padding: 16px; }
          .card-title {
            font-size: 1.2em;
            font-weight: 500;
            margin-bottom: 16px;
            color: var(--primary-text-color);
          }
          .field-group {
            margin-bottom: 14px;
          }
          label {
            display: block;
            font-size: 0.85em;
            color: var(--secondary-text-color);
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          input[type="text"] {
            width: 100%;
            padding: 8px 12px;
            border-radius: 8px;
            border: 1px solid var(--divider-color);
            background: var(--card-background-color);
            color: var(--primary-text-color);
            font-size: 1em;
            box-sizing: border-box;
          }
          input[type="text"]:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          textarea {
            width: 100%;
            height: 120px;
            padding: 10px 12px;
            border-radius: 8px;
            border: 1px solid var(--divider-color);
            background: var(--card-background-color);
            color: var(--primary-text-color);
            font-size: 0.95em;
            font-family: inherit;
            resize: vertical;
            box-sizing: border-box;
          }
          .new-badge {
            display: inline-block;
            margin-left: 8px;
            padding: 2px 8px;
            font-size: 0.75em;
            background: var(--primary-color);
            color: var(--text-primary-color, white);
            border-radius: 10px;
            text-transform: uppercase;
          }
          .validate-btn {
            width: 100%;
            padding: 12px;
            margin-top: 8px;
            border: none;
            border-radius: 8px;
            background: var(--primary-color);
            color: var(--text-primary-color, white);
            font-size: 1em;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
          }
          .validate-btn:hover {
            opacity: 0.9;
          }
          .validate-btn.delete {
            background: var(--error-color, #db4437);
          }
          .feedback {
            margin-top: 10px;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 0.9em;
            text-align: center;
          }
          .feedback.success {
            background: rgba(76, 175, 80, 0.15);
            color: #4caf50;
          }
          .feedback.error {
            background: rgba(219, 68, 55, 0.15);
            color: #db4437;
          }
        </style>
        <ha-card>
          <div class="card-title">${this._title}</div>
  
          <div class="field-group">
            <label for="level1-input">Énigme</label>
            <input
              type="text"
              id="level1-input"
              list="level1-list"
              value="${this._escapeAttr(this._level1Value)}"
              placeholder="Nom de l'énigme..."
              autocomplete="off"
            />
            <datalist id="level1-list">
              ${level1Options.map((o) => `<option value="${this._escapeAttr(o)}">`).join("")}
            </datalist>
          </div>
  
          <div class="field-group">
            <label for="level2-input">Sous-catégorie</label>
            <input
              type="text"
              id="level2-input"
              list="level2-list"
              value="${this._escapeAttr(this._level2Value)}"
              placeholder="Nom de la sous-catégorie..."
              autocomplete="off"
              ${!this._level1Value ? "disabled" : ""}
            />
            <datalist id="level2-list">
              ${level2Options.map((o) => `<option value="${this._escapeAttr(o)}">`).join("")}
            </datalist>
          </div>
  
          <div class="field-group">
            <label for="level3-input">
              Indice
              ${isNewIndice ? '<span class="new-badge">Nouveau</span>' : ""}
            </label>
            <input
              type="text"
              id="level3-input"
              list="level3-list"
              value="${this._escapeAttr(this._level3Value)}"
              placeholder="Nom de l'indice..."
              autocomplete="off"
              ${!this._level2Value ? "disabled" : ""}
            />
            <datalist id="level3-list">
              ${level3Options.map((o) => `<option value="${this._escapeAttr(o)}">`).join("")}
            </datalist>
          </div>
  
          <div class="field-group">
            <label for="contenue-textarea">Contenu de l'indice</label>
            <textarea
              id="contenue-textarea"
              placeholder="${this._originalContenue === null ? "Entrer le contenu de votre indice" : ""}"
              ${!this._level3Value ? "disabled" : ""}
            >${this._escapeHtml(this._contenueValue)}</textarea>
          </div>
  
          <button class="validate-btn ${this._contenueValue.trim() === "" && this._originalContenue !== null ? "delete" : ""}" id="validate-btn">
            ${
              this._contenueValue.trim() === "" && this._originalContenue !== null
                ? "🗑 Supprimer l'indice"
                : "✔ Valider"
            }
          </button>
  
          ${
            this._feedbackMsg
              ? `<div class="feedback ${this._feedbackError ? "error" : "success"}">${this._escapeHtml(this._feedbackMsg)}</div>`
              : ""
          }
        </ha-card>
      `;
  
      this._attachEvents();
  
      // Restaure le focus/curseur du textarea après re-render
      if (activeIsTextarea) {
        const ta = this.shadowRoot.getElementById("contenue-textarea");
        ta.focus();
        ta.setSelectionRange(cursorPos, cursorPos);
      }
    }
  
    _attachEvents() {
      const l1 = this.shadowRoot.getElementById("level1-input");
      const l2 = this.shadowRoot.getElementById("level2-input");
      const l3 = this.shadowRoot.getElementById("level3-input");
      const contenue = this.shadowRoot.getElementById("contenue-textarea");
      const validateBtn = this.shadowRoot.getElementById("validate-btn");
  
      if (l1) {
        l1.addEventListener("input", (e) => this._onLevel1Input(e.target.value));
        l1.addEventListener("change", (e) => this._onLevel1Input(e.target.value));
      }
      if (l2) {
        l2.addEventListener("input", (e) => this._onLevel2Input(e.target.value));
        l2.addEventListener("change", (e) => this._onLevel2Input(e.target.value));
      }
      if (l3) {
        l3.addEventListener("input", (e) => this._onLevel3Input(e.target.value));
        l3.addEventListener("change", (e) => this._onLevel3Input(e.target.value));
      }
      if (contenue) {
        contenue.addEventListener("input", (e) => this._onContenueInput(e.target.value));
      }
      if (validateBtn) {
        validateBtn.addEventListener("click", () => this._onValidate());
      }
    }
  
    _escapeHtml(str) {
      return String(str ?? "")
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>');
    }
  
    _escapeAttr(str) {
      return String(str ?? "")
        .replace(/&/g, '&')
        .replace(/"/g, '"')
        .replace(/</g, '<')
        .replace(/>/g, '>');
    }
  }
  
  customElements.define("hints-editor-card", HintsEditorCard);
  
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "hints-editor-card",
    name: "Hints Editor Card",
    description: "Carte d'ajout/modification/suppression d'indices pour escape game",
  });