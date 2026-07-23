interface Window {
  vibefield: {
    submitRendererLogs(serializedBatch: string): boolean;
    getConnection(): Promise<{ port: number; token: string }>;
    onPrepareClose(handler: (requestId: string) => void): () => void;
    completeClose(result: { requestId: string; ok: boolean; error?: string }): void;
  };
}
