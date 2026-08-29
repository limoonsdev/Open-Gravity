import { ModelSelector } from '../model-selector';

export async function modelsCommand() {
  const selector = new ModelSelector(() => {
    process.exit(0);
  });
  await selector.start();
}
