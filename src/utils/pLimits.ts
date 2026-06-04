/**
 * Tiny dependency-free concurrency limiter. Equivalent to `p-limit` for our
 * needs — bounds the number of in-flight promises so we don't blow past
 * Facebook Graph rate limits while still parallelizing aggressively.
 */
export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function pLimit(concurrency: number): Limiter {
    const max = Math.max(1, concurrency | 0);
    let active = 0;
    const queue: Array<() => void> = [];

    const next = () => {
        if (active >= max) return;
        const runner = queue.shift();
        if (runner) {
            active += 1;
            runner();
        }
    };

    return <T>(fn: () => Promise<T>): Promise<T> =>
        new Promise<T>((resolve, reject) => {
            const run = () => {
                fn()
                    .then(resolve, reject)
                    .finally(() => {
                        active -= 1;
                        next();
                    });
            };
            queue.push(run);
            next();
        });
}

/** Run `fn` over `items` with bounded concurrency, preserving input order. */
export async function mapLimit<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const limit = pLimit(concurrency);
    return Promise.all(items.map((item, i) => limit(() => fn(item, i))));
}
