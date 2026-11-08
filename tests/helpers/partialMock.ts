/**
 * Stands a partial fake in for the full interface it replaces. The test supplies only the members
 * the code under test touches, so completeness is not checked; this is the single cast for such fakes.
 */
export function partialMock<T>(fake: object): T {
  return fake as unknown as T;
}
