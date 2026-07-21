// The full preload surface (design-03 A2): one connection descriptor, nothing else.
interface Window {
  vibefield: {
    getConnection(): Promise<{ port: number; token: string }>;
  };
}
