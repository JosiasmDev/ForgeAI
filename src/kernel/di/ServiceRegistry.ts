import { IServiceRegistry, ServiceToken, ServiceRegistration, Scope } from './types';

export class ServiceRegistry implements IServiceRegistry {
  private registrations = new Map<ServiceToken<unknown>, ServiceRegistration<unknown>>();
  private parent?: ServiceRegistry;

  constructor(parent?: ServiceRegistry) {
    this.parent = parent;
  }

  public register<T>(token: ServiceToken<T>, factory: () => T, scope: Scope = 'singleton'): void {
    this.registrations.set(token as ServiceToken<unknown>, {
      token: token as ServiceToken<unknown>,
      factory: factory as () => unknown,
      scope,
    });
  }

  public resolve<T>(token: ServiceToken<T>): T {
    const instance = this.tryResolve(token);
    if (instance === null) {
      throw new Error(`[ServiceRegistry] Service not registered for token: ${token.description}`);
    }
    return instance;
  }

  public tryResolve<T>(token: ServiceToken<T>): T | null {
    const reg = this.registrations.get(token as ServiceToken<unknown>);
    if (!reg) {
      if (this.parent) {
        return this.parent.tryResolve(token);
      }
      return null;
    }

    if (reg.scope === 'singleton') {
      if (!reg.instance) {
        reg.instance = reg.factory();
      }
      return reg.instance as T;
    } else if (reg.scope === 'transient') {
      return reg.factory() as T;
    } else if (reg.scope === 'scoped') {
      if (!reg.instance) {
        reg.instance = reg.factory();
      }
      return reg.instance as T;
    }

    return null;
  }

  public has(token: ServiceToken<unknown>): boolean {
    if (this.registrations.has(token)) return true;
    if (this.parent) return this.parent.has(token);
    return false;
  }

  public override<T>(token: ServiceToken<T>, factory: () => T): void {
    const existing = this.registrations.get(token as ServiceToken<unknown>);
    const scope = existing ? existing.scope : 'singleton';
    this.registrations.set(token as ServiceToken<unknown>, {
      token: token as ServiceToken<unknown>,
      factory: factory as () => unknown,
      scope,
    });
  }

  public createScope(): IServiceRegistry {
    return new ServiceRegistry(this);
  }

  public listRegistrations(): ServiceRegistration[] {
    const list = Array.from(this.registrations.values());
    if (this.parent) {
      return [...this.parent.listRegistrations(), ...list];
    }
    return list;
  }
}
