export interface ForgePlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
}

export interface IPluginLoader {
  registerPlugin(plugin: ForgePlugin): void;
  activatePlugin(pluginId: string): Promise<void>;
  getPlugins(): ForgePlugin[];
}
