export interface ReactAPI {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  Fragment: unknown;
  useState<T>(initial: T): [T, (next: T | ((current: T) => T)) => void];
  useRef<T>(initial: T): { current: T };
  useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void;
}
