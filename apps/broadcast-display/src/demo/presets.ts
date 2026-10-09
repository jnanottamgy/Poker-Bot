/** Demo scenarios (?demo=1&preset=...). Kept apart from the engine so the live bundle never loads the engine. */
export const DEMO_PRESETS = ['running', 'final', 'bubble', 'break', 'paused', 'frozen', 'champion', 'pre'] as const;
export type DemoPreset = (typeof DEMO_PRESETS)[number];
