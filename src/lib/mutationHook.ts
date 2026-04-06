import { MutationFunction, useMutation, UseMutationOptions, UseMutationResult } from "@tanstack/react-query";
import _ from "lodash";

type CustomMutationOptions<TParams, TResponse> = Omit<UseMutationOptions<TResponse, Error, TParams>, 'mutationFn'>

export type MutationHookFn<TParams = void, TResponse = unknown> = {
    (opts?: CustomMutationOptions<TParams, TResponse>): UseMutationResult<TResponse, Error, TParams>;
    options(opts: Partial<UseMutationOptions<TResponse, Error, TParams>>): MutationHookFn<TParams, TResponse>;
    onSuccess(callback: UseMutationOptions<TResponse, Error, TParams>['onSuccess']): MutationHookFn<TParams, TResponse>;
    onError(callback: UseMutationOptions<TResponse, Error, TParams>['onError']): MutationHookFn<TParams, TResponse>;
    mutationFn<P, R>(mutationFn: (params: P) => Promise<R>): MutationHookFn<P, R>;
    meta(meta: () => Dict<unknown>): MutationHookFn<TParams, TResponse>;
}

interface ICreateMutationExtraOptions {
    meta?: () => Dict<unknown>
}

function createMutationHook<TParams, TResponse>(
    mutationFn: MutationFunction<TResponse, TParams>,
    additionalOptions: Partial<UseMutationOptions<TResponse, Error, TParams>> = {},
    extraOptions?: ICreateMutationExtraOptions
): MutationHookFn<TParams, TResponse> {
    const hookFn = (opts?: CustomMutationOptions<TParams, TResponse>) => {
        const meta = extraOptions?.meta?.() ?? {}
        return useMutation<TResponse, Error, TParams>({
            mutationFn,
            networkMode: 'always',
            ...additionalOptions,
            ...opts,
            meta: Object.assign(meta, additionalOptions?.meta, opts?.meta)
        });
    };

    const hook = Object.assign(hookFn, {
        options(opts: Partial<UseMutationOptions<TResponse, Error, TParams>>): MutationHookFn<TParams, TResponse> {
            return createMutationHook(mutationFn, {
                ...additionalOptions,
                ...opts
            });
        },
        onSuccess(callback: (data: TResponse, params: TParams) => void): MutationHookFn<TParams, TResponse> {
            return this.options({ onSuccess: callback });
        },
        onError(callback: (error: Error, params: TParams) => void): MutationHookFn<TParams, TResponse> {
            return this.options({ onError: callback });
        },
        mutationFn<P, R>(newMutationFn: (params: P) => Promise<R>): MutationHookFn<P, R> {
            return createMutationHook(newMutationFn, _.omit(additionalOptions, 'mutationFn') as Partial<UseMutationOptions<R, Error, P>>);
        },
        meta(meta: () => Dict<unknown>) {
            return createMutationHook(mutationFn, additionalOptions, { meta })
        }
    });

    return hook as MutationHookFn<TParams, TResponse>;
}

export const mutationHook = {
    mutate<TParams = void, TResponse = void>(mutationFn: (params: TParams) => Promise<TResponse>): MutationHookFn<TParams, TResponse> {
        return createMutationHook(mutationFn);
    },
    create<TParams = void, TResponse = void>(options: UseMutationOptions<TResponse, Error, TParams>): MutationHookFn<TParams, TResponse> {
        return createMutationHook(options.mutationFn!, options);
    }
};
