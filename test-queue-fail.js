const _global = globalThis;
if (!_global.sqliteTransactionQueue) {
    _global.sqliteTransactionQueue = Promise.resolve();
}

function enqueueTransaction(task) {
    const queue = _global.sqliteTransactionQueue;
    const taskPromise = queue.then(() => task());
    
    _global.sqliteTransactionQueue = taskPromise.catch((err) => {
        // Caught!
    });
    
    return taskPromise;
}

async function run() {
    let transactionActive = false;

    async function withTransactionAsync(taskFn) {
        if (transactionActive) {
            console.log(Date.now(), 'BEGIN FAILED! cannot start a transaction');
            throw new Error('cannot start a transaction');
        }
        transactionActive = true;
        console.log(Date.now(), 'BEGIN SUCCEEDED');
        try {
            await taskFn();
            console.log(Date.now(), 'COMMIT SUCCEEDED');
        } catch (e) {
            console.log(Date.now(), 'ROLLBACK SUCCEEDED');
            throw e;
        } finally {
            transactionActive = false;
        }
    }

    async function cacheEntityList(name, fail) {
        return enqueueTransaction(async () => {
            console.log(Date.now(), `cacheEntityList ${name} started`);
            await withTransactionAsync(async () => {
                await new Promise(r => setTimeout(r, 50)); // simulate prepareAsync
                if (fail) throw new Error('Query failed');
                await new Promise(r => setTimeout(r, 50)); // simulate execute
            });
            console.log(Date.now(), `cacheEntityList ${name} finished`);
        });
    }

    cacheEntityList('T1', true).catch(() => console.log('T1 threw to caller'));
    cacheEntityList('T2', false).catch(() => console.log('T2 threw to caller'));
}

run();
