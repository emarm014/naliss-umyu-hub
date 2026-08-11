/**
 * Fire a promise without awaiting — errors are logged, never crash.
 * This prevents Unhandled Promise Rejection crashes in React Native.
 */
export const safeFire = (promise: Promise<any>, label?: string) => {
    promise.catch((err) => {
        console.warn(`[safeFire${label ? `:${label}` : ''}]`, err);
    });
};
