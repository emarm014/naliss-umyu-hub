const _global = globalThis;
if (!_global.sqliteTransactionQueue) {
    _global.sqliteTransactionQueue = Promise.resolve();
}

function enqueueTransaction(task) {
    const queue = _global.sqliteTransactionQueue;
    const taskPromise = queue.then(() => task());
    
    _global.sqliteTransactionQueue = taskPromise.catch((err) => {
        console.error('error', err);
    });
    
    return taskPromise;
}

async function run() {
    let active = 0;
    
    async function task(id) {
        console.log(`Task ${id} starting...`);
        active++;
        if (active > 1) {
            console.error(`COLLISION! Task ${id} detected active=${active}`);
        }
        await new Promise(r => setTimeout(r, 100));
        active--;
        console.log(`Task ${id} done.`);
    }

    enqueueTransaction(() => task(1));
    enqueueTransaction(() => task(2));
    enqueueTransaction(() => task(3));
    enqueueTransaction(() => task(4));
}

run();
