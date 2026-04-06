import { UseQueryResult, useQuery, UseInfiniteQueryOptions, UseInfiniteQueryResult, useInfiniteQuery, InfiniteData, QueryClient } from "@tanstack/react-query";
import _ from "lodash";
import { useMemo } from "react";

type UseQueryOptions<T, E, ST, K extends readonly unknown[]> = Parameters<typeof useQuery<T, E, ST, K>>[0]
export type CustomQueryHookOptions<T, K extends readonly unknown[]> = Omit<UseQueryOptions<T, Error, T, K>, 'queryFn' | 'queryKey' | 'select' | 'query'>

type SelectFn<T, P, D, ST> = (data: T | undefined, params: P, qData: D) => ST

export type QueryHookFn<T, P = void, D = void, ST = {}, K extends readonly unknown[] = readonly unknown[], UR = UseQueryResult<T>> = (undefined extends P ? {
    (params?: P, opts?: CustomQueryHookOptions<T, K>): UR & ST;
} : {
    (params: P, opts?: CustomQueryHookOptions<T, K>): UR & ST;
}) & {
    key: (params?: P, data?: D) => K;
    invalidate: (params?: P, data?: D) => void;
    prefetch: (params: P, data: D, forceRefetch?: boolean) => Promise<ST | undefined>
    getRawCachedData: (params: P, data: D) => T | undefined
    getCachedData: (params: P, data: D) => ST | undefined
    setData: (params: P, data: D, newData: T | ((oldData: T | undefined) => T)) => ST | undefined
    data<D2>(fn: (params: P) => D2): QueryHookFn<T, P, D & D2, ST, K, UR>
    params<P2>(fn: (params: P2) => P): QueryHookFn<T, P2, D, ST, K, UR>
    extend<ST2>(fn: (result: T | undefined, extResult: ST) => ST2): QueryHookFn<T, P, D, ST2, K, UR>

    context?: typeof QueryHookContext
}

class KeyBuilder<P, K extends readonly unknown[], D> {
    constructor(
        private keyFn: (params: P, data: D) => K,
        private dataFn: (params: P) => D
    ) {}

    useQuery<T>(
        queryOptionsFn: (ctx: IQueryFnContext<P, D>) => Omit<UseQueryOptions<T, Error, T, K>, 'queryKey'>
    ): QueryBuilder<T, P, D, K> {
        return new QueryBuilder(this.dataFn, this.keyFn, queryOptionsFn);
    }

    useInfiniteQuery<T>(
        queryOptionsFn: (ctx: IQueryFnContext<P, D>) => Omit<UseInfiniteQueryOptions<T, Error, T, K, number>, 'queryKey'>
    ): InfiniteQueryBuilder<T, P, D, K> {
        return new InfiniteQueryBuilder(this.dataFn, this.keyFn, queryOptionsFn);
    }
}

interface IQueryFnContext<P, D> {
    params: P,
    data: D
}

function createHookWrapper<T, P = void, D = void, ST = {}, K extends readonly unknown[] = readonly unknown[], UR = UseQueryResult<T>>(
    hookFn: (params?: P, opts?: CustomQueryHookOptions<T, K>, _selFn?: SelectFn<T, P, D, ST>) => UseQueryResult<T> & ST,
    keyFn: (params?: P, data?: D) => K,
    prefetchFn: (params?: P, data?: D) => T,
    selectFn: (data: T | undefined, params: P, qData: D) => ST
): QueryHookFn<T, P, D, ST, K, UR> {
    const getRawCachedData = (params: P, data: D) => {
        const key = keyFn(params, data)
        return QueryHookContext.queryClient?.getQueryData(key) as T | undefined
    }

    const getCachedData = (params: P, data: D) => {
        const rawData = getRawCachedData(params, data)
        if (rawData === undefined) return undefined 
        return selectFn(rawData, params, data)
    }

    //@ts-expect-error: Ignore typings as hookFn cannot complete InfiniteQueryBuilder
    return Object.assign(hookFn, {
        key: keyFn,
        invalidate: (params?: P, data?: D) => {
            const key = _.dropRightWhile(keyFn(params!, data!), _.isUndefined);
            QueryHookContext.queryClient?.invalidateQueries({ queryKey: key });
        },
        async prefetch(params: P, data: D, forceRefetch?: boolean) {
            const cachedData = getRawCachedData(params, data)
            const prefetchedData = (cachedData !== undefined && !forceRefetch) ? cachedData as T : await prefetchFn(params, data)
            if (prefetchedData === undefined) return undefined

            const key = keyFn(params, data)
            QueryHookContext.queryClient?.setQueryData<T>(key, prefetchedData)
            return selectFn(prefetchedData, params, data)
        },
        getRawCachedData,
        getCachedData,
        setData(params: P, data: D, newData: T | ((oldData: T | undefined) => T)) {
            const key = keyFn(params, data)
            const updatedData = _.isFunction(newData)
                ? newData(getRawCachedData(params, data))
                : newData
            QueryHookContext.queryClient?.setQueryData<T>(key, updatedData)
            return selectFn(updatedData, params, data)
        },
        params<P2>(fn: (params: P2) => P) {
            return createHookWrapper<T, P2, D, ST, K, UR>(
                (params, opts, _selectFn) => hookFn(fn(params!), opts, _selectFn ? (data, params, qData) => _selectFn(data, params as unknown as P2, qData) : undefined),
                (params, data) => keyFn(fn(params!), data),
                (params, data) => prefetchFn(fn(params!), data),
                (result, params, data) => selectFn(result, fn(params), data)
            )
        },
        extend<ST2>(fn: (result: T | undefined, extResult: ST) => ST2) {
            const newSelectFn: SelectFn<T, P, D, ST2> = (result, params, data) => fn(result, selectFn(result, params, data))
            return createHookWrapper<T, P, D, ST2, K, UR>(
                (params, opts, _selectFn) => hookFn(params, opts, (_selectFn ?? newSelectFn) as unknown as SelectFn<T, P, D, ST>),
                keyFn, prefetchFn, newSelectFn
            )
        },
        context: QueryHookContext
    });
}

abstract class BaseQueryBuilder<T, P = void, D = void, K extends readonly unknown[] = readonly unknown[], OPTS = Omit<UseQueryOptions<T, Error, T, K>, 'queryKey'>, UR = UseQueryResult<T>> {
    constructor(
        public dataFn: (params: P) => D,
        public keyFn: (params: P, data: D) => K,
        public queryOptionsFn: (context: IQueryFnContext<P, D>) => OPTS
    ) {}

    options(fn: (context: IQueryFnContext<P, D>) => Partial<OPTS>) {
        const orgFn = this.queryOptionsFn;
        this.queryOptionsFn = (context) => ({
            ...orgFn(context),
            ...fn(context)
        });
        return this;
    }

    extend<ST>(selectFn: SelectFn<T, P, D, ST>) {
        return this.build(selectFn);
    }

    create() {
        return this.build(() => ({}));
    }

    protected abstract executeQuery(
        queryOptions: OPTS,
        queryKey: K,
        opts?: CustomQueryHookOptions<T, K>
    ): UseQueryResult<T>;

    build<ST>(selectFn: SelectFn<T, P, D, ST>): QueryHookFn<T, P, D, ST, K, UR> {
        const { keyFn, dataFn, queryOptionsFn } = this;
        const executeQuery = this.executeQuery.bind(this);

        const hookFn = (params?: P, opts?: CustomQueryHookOptions<T, K>, _selectFn?: SelectFn<T, P, D, ST>) => {
            const data = dataFn(params!);
            const ctx = { params: params!, data }
            const queryKey = keyFn(ctx.params, ctx.data);
            const queryOptions = queryOptionsFn(ctx);
            const query = executeQuery(queryOptions, queryKey, opts);
            const extData = useMemo(() => {
                const selFn = _selectFn ?? selectFn
                return selFn(query.data, params!, data)
            }, [query.data])
            return Object.assign(query, extData)
        };

        const prefetchFn = async (ctx: IQueryFnContext<P, D>) => {
            const queryOptions = queryOptionsFn({ params: ctx.params, data: ctx.data });
            const queryFn = (queryOptions as UseQueryOptions<T, Error, T, K>).queryFn
            if (_.isFunction(queryFn)) {
                //@ts-expect-error: we can't implement signal
                return await queryFn({ client: QueryHookContext.queryClient!, pageParam: 0, queryKey: queryOptions.queryKey, meta: undefined, signal: undefined });
            }
            return undefined
        };

        //@ts-expect-error: keyFn is expected to not match to the keyFn in the hookFn
        return createHookWrapper(hookFn, keyFn, prefetchFn, selectFn);
    }
}

class QueryBuilder<T, P, D, K extends readonly unknown[]> extends BaseQueryBuilder<T, P, D, K, Omit<UseQueryOptions<T, Error, T, K>, 'queryKey'>> {
    protected executeQuery(
        queryOptions: Omit<UseQueryOptions<T, Error, T, K>, 'queryKey'>,
        queryKey: K,
        opts?: CustomQueryHookOptions<T, K>
    ): UseQueryResult<T> {
        return useQuery<T, Error, T, K>({
            ...queryOptions,
            queryKey,
            ...opts,
            enabled: (opts?.enabled === undefined || !!opts.enabled) && (queryOptions.enabled === undefined || !!queryOptions.enabled)
        });
    }
}

class InfiniteQueryBuilder<T, P, D, K extends readonly unknown[]> extends BaseQueryBuilder<InfiniteData<T>, P, D, K, Omit<UseInfiniteQueryOptions<T, Error, T, K, number>, 'queryKey'>, UseInfiniteQueryResult<InfiniteData<T>>> {
    protected executeQuery(
        queryOptions: Omit<UseInfiniteQueryOptions<T, Error, T, K, number>, 'queryKey'>,
        queryKey: K,
        opts?: CustomQueryHookOptions<InfiniteData<T>, K>
    ): UseInfiniteQueryResult<InfiniteData<T>> {
        //@ts-expect-error: No need match the inf query to the query
        return useInfiniteQuery({
            ...queryOptions,
            queryKey,
            ...opts,
            enabled: (opts?.enabled === undefined || !!opts.enabled) && (queryOptions.enabled === undefined || !!queryOptions.enabled)
        })
    }
}

export const queryHook = {
    ofKey: <P = void, K extends readonly unknown[] = readonly unknown[]>(keyFn: (params: P) => K) => {
        return new KeyBuilder<P, K, void>((params) => keyFn(params), () => undefined as void);
    },
    useData: <P = void, D = void>(dataFn: (params: P) => D) => ({
        ofKey: <K extends readonly unknown[]>(keyFn: (params?: P, data?: D) => K) => {
            return new KeyBuilder(keyFn, dataFn);
        }
    })
};

export const QueryHookContext = {
    queryClient: undefined as QueryClient | undefined
};

export function setQueryHookContext(ctx?: Partial<typeof QueryHookContext>) {
    Object.assign(QueryHookContext, ctx)
}

const MemoizedQueryFields = [
    'data',
    'error',
    'status',
    'isLoading',
    'isError',
    'isSuccess',
    'isPending',
    'fetchStatus'
] as const
type MemoizedQueryField = (typeof MemoizedQueryFields)[number];

type RQResultObject = {
    [K in MemoizedQueryField]: UseQueryResult[K]
}

export function useRQMemo<T extends RQResultObject, TOutput>(
    fn: (query: T) => TOutput,
    query: T
): TOutput {
    const deps = MemoizedQueryFields.map(f => query[f])
    return useMemo(() => fn(query), deps);
}

export function memoizRQ<T extends RQResultObject>(query: T) {
    return useRQMemo(q => q, query)
}
