import type { TestContext } from 'node:test';

const scopes = new WeakMap<TestContext, Array<() => unknown>>();
/** Node after hooks are FIFO. Resource teardown must be LIFO, before directory removal. */
export function defer(t: TestContext, cleanup: () => unknown) {
    let stack = scopes.get(t);
    if (!stack) {
        stack = [];
        scopes.set(t, stack);
        const cleanups = stack;
        t.after(async () => {
            const errors: unknown[] = [];
            while (cleanups.length) {
                try {
                    await cleanups.pop()!();
                } catch (error) {
                    errors.push(error);
                }
            }
            if (errors.length)
                throw new AggregateError(errors, 'Resource teardown failed');
        });
    }
    stack.push(cleanup);
}

/** Register immediately, including handles created before an assertion can fail. */
export function track<T extends { close(): unknown }>(
    t: TestContext,
    resource: T,
): T {
    defer(t, () => resource.close());
    return resource;
}
