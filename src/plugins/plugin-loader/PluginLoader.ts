import { IPluginLoader, ForgePlugin } from './types';

export class PluginLoader implements IPluginLoader {
  private plugins = new Map<string, ForgePlugin>();

  public registerPlugin(plugin: ForgePlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  public async activatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);
    await plugin.activate();
  }

  public getPlugins(): ForgePlugin[] {
    return Array.from(this.plugins.values());
  }
}
