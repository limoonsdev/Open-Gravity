"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelsCommand = modelsCommand;
const model_selector_1 = require("../model-selector");
async function modelsCommand() {
    const selector = new model_selector_1.ModelSelector(() => {
        process.exit(0);
    });
    await selector.start();
}
//# sourceMappingURL=models.js.map