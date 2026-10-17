/** Invalidates older reads without cancelling the underlying transport. */
export class LatestRequest {
  private generation = 0;

  invalidate(): void {
    this.generation += 1;
  }

  async read<T>(operation: () => Promise<T>): Promise<{ value: T } | null> {
    const generation = ++this.generation;
    try {
      const value = await operation();
      return generation === this.generation ? { value } : null;
    } catch (error) {
      if (generation !== this.generation) return null;
      throw error;
    }
  }
}

/** Background refreshes cannot change the author's selected task. */
export class SelectedRequest {
  private selected: string | null = null;
  private latest = new LatestRequest();

  reset(selected: string | null = null): void {
    this.selected = selected;
    this.latest.invalidate();
  }

  async read<T>(
    key: string,
    operation: () => Promise<T>,
    refresh = false,
  ): Promise<{ value: T } | null> {
    if (refresh && key !== this.selected) return null;
    this.selected = key;
    return this.latest.read(operation);
  }
}
