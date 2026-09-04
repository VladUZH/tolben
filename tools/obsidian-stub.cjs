// Obsidian's UI shell, and nothing else, for running the shipped bundle outside Obsidian.
//
// tools/plugin-lifecycle.mjs loads obsidian-plugin/main.js with this in place of the
// `obsidian` module. The stub covers the five classes the bundle imports and the handful
// of Plugin methods onload() calls; the status bar is a string, a Notice is a log line, a
// Modal is an empty object. Nothing about the model, the server, the provisioner or the
// plugin's own control flow is faked — that is the point of the exercise.
const rig = () => globalThis.__tolbenRig;

class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  addStatusBarItem() {
    const el = { text: "", setText: (text) => { el.text = text; rig().log(`   status bar -> ${JSON.stringify(text)}`); } };
    return el;
  }
  addCommand() {}
  addSettingTab() {}
  registerEditorExtension() {}
  async loadData() { return rig().data; }
  async saveData(data) {
    rig().data = JSON.parse(JSON.stringify(data));
    rig().log(`   data.json saved: ${JSON.stringify({ setupDone: data.setupDone, baseUrl: data.baseUrl, idleUnloadMinutes: data.idleUnloadMinutes })}`);
  }
}
class Modal { constructor() { this.contentEl = {}; } open() {} close() {} }
class Notice { constructor(message) { rig().log(`   Notice: ${message}`); } }
class Setting {
  setName() { return this; } setDesc() { return this; } addText() { return this; }
  addToggle() { return this; } addDropdown() { return this; } addButton() { return this; }
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = {}; } }

module.exports = { Plugin, Modal, Notice, Setting, PluginSettingTab };
