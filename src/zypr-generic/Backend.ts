import { List, Record, RecordOf } from 'immutable'
import { EndoPart } from '../Endo'
import { Direction } from './Direction'
import { Query } from './Editor'
import { Node, NodeVariantExpModifier } from './Node'

// Env: render environment
// Dat: render data

export type Backend<Exp, Zip, Dat> = {
    props: Props<Exp, Zip, Dat>,
    state: State<Exp, Zip, Dat>
}

export type Props<Exp, Zip, Dat> = {
    format: (st: State<Exp, Zip, Dat>, query: Query) => Node<Dat>,
    interpQueryString: (st: State<Exp, Zip, Dat>, str: string) => Action<Exp, Zip>[],
    handleAction: (act: Action<Exp, Zip>) => EndoPart<State<Exp, Zip, Dat>>
}

export function interpQueryAction<Exp, Zip, Dat>(
    backend: Props<Exp, Zip, Dat>,
    st: State<Exp, Zip, Dat>,
    query: Query
): Action<Exp, Zip> | undefined {
    const acts = backend.interpQueryString(st, query.str)
    if (acts.length === 0) return undefined
    return acts[query.i % acts.length]
}

export function handleQueryAction<Exp, Zip, Dat>(
    backend: Props<Exp, Zip, Dat>,
    st: State<Exp, Zip, Dat>,
    query: Query
): EndoPart<State<Exp, Zip, Dat>> | undefined {
    const act = interpQueryAction(backend, st, query)
    if (act === undefined) return undefined
    return backend.handleAction(act)
}

export type Action<Exp, Zip>
    = { case: 'move', dir: Direction }
    | { case: 'set_cursor', cursor: Cursor<Exp, Zip> }
    | { case: 'replace', exp: Exp }
    | { case: 'insert', zip: Zip }
    | { case: BasicAction }
export type BasicAction = 'undo' | 'redo' | 'copy' | 'paste' | 'delete' | 'move'

export type State<Exp, Zip, Dat> = RecordOf<State_<Exp, Zip, Dat>>
export const makeState = <Exp, Zip, Dat>(state_: State_<Exp, Zip, Dat>): State<Exp, Zip, Dat> => Record<State_<Exp, Zip, Dat>>(state_)()
export type State_<Exp, Zip, Dat> = {
    mode: Mode<Exp, Zip>,
    clipboard: Clipboard<Exp, Zip>,
    history: List<State<Exp, Zip, Dat>>,
    future: List<State<Exp, Zip, Dat>>
}

export type Mode<Exp, Zip>
    = { case: 'cursor', cursor: Cursor<Exp, Zip> }
    | { case: 'select', select: Select<Exp, Zip> }

export type Cursor<Exp, Zip> = { zip: Zip, exp: Exp }

export type Select<Exp, Zip> = { zip_top: Zip, zip_bot: Zip, exp: Exp, orient: Orient }

export type Clipboard<Exp, Zip>
    = { case: 'exp', exp: Exp }
    | { case: 'zip', zip: Zip }
    | undefined

// up: the top of the select can move
// down: the bot of the select can move
export type Orient = 'up' | 'down'

// updateState

export function updateMode<Exp, Zip, Dat>(f: EndoPart<Mode<Exp, Zip>>): EndoPart<State<Exp, Zip, Dat>> {
    return (st) => {
        return st
            .update('mode', (mode) => f(mode) ?? mode)
            .update('history', (hist) => hist.unshift(st))
            .set('future', List([]))
    }
}

export function undo<Exp, Zip, Dat>(): EndoPart<State<Exp, Zip, Dat>> {
    return (st) => {
        const st_ = st.get('history').get(0)
        if (st_ === undefined) return undefined
        return st
            .update('future', futr => futr.unshift(st))
    }
}

export function redo<Exp, Zip, Dat>(): EndoPart<State<Exp, Zip, Dat>> {
    return (st) => {
        const st_ = st.get('future').get(0)
        if (st_ === undefined) return undefined
        return st
            .update('history', hist => hist.unshift(st))
    }
}

// buildBackend

export function buildBackend<Exp, Step, Dat, Env>(
    // formatting
    initEnv: Env,
    formatExp: (exp: Exp, modifier: NodeVariantExpModifier) => (env: Env) => Node<Dat>,
    formatZip: (zip: List<Step>, modifier: NodeVariantExpModifier) => (kid: (env: Env) => Node<Dat>) => (env: Env) => Node<Dat>,
    // actions
    interpQueryString: (st: State<Exp, List<Step>, Dat>, str: string) => Action<Exp, List<Step>>[],
    handleAction: (act: Action<Exp, List<Step>>) => EndoPart<State<Exp, List<Step>, Dat>>,
    // program
    initExp: Exp,
): Backend<Exp, List<Step>, Dat> {
    return {
        props: {
            format: (st, query) => {
                function formatQueryAround(kid: (env: Env) => Node<Dat>): (env: Env) => Node<Dat> {
                    if (query.str.length > 0) {
                        const acts = interpQueryString(st, query.str)
                        if (acts.length === 0) {
                            return (env) => ({
                                case: 'query-invalid',
                                string: query.str,
                                kids: [kid(env)]
                            })
                        } else {
                            const act = acts[query.i % acts.length]
                            switch (act.case) {
                                case 'replace': {
                                    return (env) => ({
                                        case: 'query-replace',
                                        kids: [
                                            formatExp(act.exp, 'query-replace')(env),
                                            kid(env)
                                        ]
                                    })
                                }
                                case 'insert': {
                                    return (env) => ({
                                        case: 'query-replace',
                                        kids: [formatZip(act.zip, 'query-insert')(kid)(env)]
                                    })
                                }
                                default: {
                                    // TODO: special display for other kinds of actions?
                                    return kid
                                }
                            }
                        }
                    } else {
                        return kid
                    }
                }

                switch (st.mode.case) {
                    case 'cursor':
                        return formatZip(st.mode.cursor.zip, undefined)
                            (formatQueryAround
                                (formatExp(st.mode.cursor.exp, 'cursor-clasp')))
                            (initEnv)
                    case 'select':
                        return formatZip(st.mode.select.zip_top, undefined)
                            (formatQueryAround
                                (formatZip(st.mode.select.zip_bot, 'select-clasp-top')
                                    (formatExp(st.mode.select.exp, 'select-clasp-bot'))))
                            (initEnv)
                }
            },
            interpQueryString,
            handleAction
        },
        state: makeState({
            mode: { case: 'cursor', cursor: { zip: List([]), exp: initExp } },
            clipboard: undefined,
            history: List([]),
            future: List([])
        })
    }
}