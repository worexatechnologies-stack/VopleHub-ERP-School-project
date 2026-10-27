/** Wait for a Celery-backed import batch and return its normal API result. */
export async function waitForImportBatch(
  baseQuery: any,
  statusUrl: string,
  accepted: any,
  signal?: AbortSignal,
): Promise<{ data: any } | { error: any }> {
  if (!accepted?.queued) return { data: accepted };

  for (let attempt = 0; attempt < 1200; attempt += 1) {
    if (signal?.aborted) {
      return { error: { status: 'CUSTOM_ERROR', error: 'Import status polling was cancelled.' } };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const statusResult = await baseQuery(statusUrl);
    if (statusResult.error) return { error: statusResult.error };

    const state = statusResult.data as { status?: string; result?: any };
    if (state.status === 'completed') return { data: state.result || {} };
    if (state.status === 'failed') {
      return { error: { status: 400, data: state.result || { detail: 'Import batch failed.' } } };
    }
  }
  return { error: { status: 'TIMEOUT_ERROR', error: 'Import batch is taking longer than expected.' } };
}
