export interface ServiceToken<T> {
  readonly description: string;
  readonly __type?: T;
}

export function createToken<T>(description: string): ServiceToken<T> {
  return { description };
}

export type Scope = 'singleton' | 'transient' | 'scoped';

export interface ServiceRegistration<T = unknown> {
  token: ServiceToken<T>;
  factory: () => T;
  scope: Scope;
  instance?: T;
}

export interface IServiceRegistry {
  register<T>(token: ServiceToken<T>, factory: () => T, scope?: Scope): void;
  resolve<T>(token: ServiceToken<T>): T;
  tryResolve<T>(token: ServiceToken<T>): T | null;
  has(token: ServiceToken<unknown>): boolean;
  override<T>(token: ServiceToken<T>, factory: () => T): void;
  createScope(): IServiceRegistry;
  listRegistrations(): ServiceRegistration[];
}
