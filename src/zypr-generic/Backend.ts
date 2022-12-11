import { List, Record, RecordOf } from 'immutable'
import { debug } from '../Debug'
import { EndoPart, EndoReadPart } from '../Endo'
import { Direction } from './Direction'
import { Query } from './Editor'
import { enterCursor, Exp, Grammar, Language, makeExpTemplate, makeHole, makeZipTemplates, moveCursor, moveSelect, Pre, Zip } from './Language'
import { ExpNode, Node, NodeStyle } from './Node'

// Env: render environment
// Dat: render data

export type Backend<Met, Rul, Val, Dat> = {
    props: Props<Met, Rul, Val, Dat>,
    state: State<Met, Rul, Val, Dat>
}

export type Props<Met, Rul, Val, Dat> = {
    language: Language<Met, Rul, Val>,
    isValidSelect: (select: Select<Met, Rul, Val>) => boolean,
    format: (st: State<Met, Rul, Val, Dat>, query: Query) => Node<Met, Rul, Val, Dat>[],
    // TODO: extend with completions
    interpretQueryString: (st: State<Met, Rul, Val, Dat>, str: string) => Action<Met, Rul, Val>[],
    interpretKeyboardCommandEvent: (st: State<Met, Rul, Val, Dat>, event: KeyboardEvent) => Action<Met, Rul, Val> | undefined,
    handleAction: (act: Action<Met, Rul, Val>) => EndoReadPart<Props<Met, Rul, Val, Dat>, State<Met, Rul, Val, Dat>>
}

export type Dat<Met, Rul, Val> = {
    pre: Pre<Met, Rul, Val>,
    indentation: number | undefined,
    isParethesized: boolean
}

export function interpretQueryAction<Met, Rul, Val, Dat>(
    backend: Props<Met, Rul, Val, Dat>,
    st: State<Met, Rul, Val, Dat>,
    query: Query
): Action<Met, Rul, Val> | undefined {
    const acts = backend.interpretQueryString(st, query.str)
    if (acts.length === 0) return undefined
    return acts[query.i % acts.length]
}

export function handleQueryAction<Met, Rul, Val, Dat>(
    backend: Props<Met, Rul, Val, Dat>,
    st: State<Met, Rul, Val, Dat>,
    query: Query
): EndoReadPart<Props<Met, Rul, Val, Dat>, State<Met, Rul, Val, Dat>> | undefined {
    const act = interpretQueryAction(backend, st, query)
    if (act === undefined) return undefined
    return backend.handleAction(act)
}

export type Action<Met, Rul, Val>
    = { case: 'move_cursor', dir: Direction }
    | { case: 'move_select', dir: Direction }
    | { case: 'set_cursor', cursor: Cursor<Met, Rul, Val> }
    | { case: 'set_select', select: Select<Met, Rul, Val> }
    | { case: 'replace-exp', exp: Exp<Met, Rul, Val> }
    | { case: 'replace-zips', zips: List<Zip<Met, Rul, Val>> }
    | { case: 'insert', zips: List<Zip<Met, Rul, Val>> }
    | { case: BasicAction }
export type BasicAction = 'undo' | 'redo' | 'copy' | 'cut' | 'paste' | 'delete' | 'escape'

export type State<Met, Rul, Val, Dat> = RecordOf<State_<Met, Rul, Val, Dat>>
export const makeState = <Met, Rul, Val, Dat>(state_: State_<Met, Rul, Val, Dat>): State<Met, Rul, Val, Dat> => Record<State_<Met, Rul, Val, Dat>>(state_)()
export type State_<Met, Rul, Val, Dat> = {
    mode: Mode<Met, Rul, Val>,
    clipboard: Clipboard<Met, Rul, Val>,
    history: List<State<Met, Rul, Val, Dat>>,
    future: List<State<Met, Rul, Val, Dat>>
}

export type Mode<Met, Rul, Val>
    = { case: 'cursor', cursor: Cursor<Met, Rul, Val> }
    | { case: 'select', select: Select<Met, Rul, Val> }

export type Cursor<Met, Rul, Val> = { zips: List<Zip<Met, Rul, Val>>, exp: Exp<Met, Rul, Val> }

export type Select<Met, Rul, Val> = { zipsTop: List<Zip<Met, Rul, Val>>, zipsBot: List<Zip<Met, Rul, Val>>, exp: Exp<Met, Rul, Val>, orient: Orient }

export type Clipboard<Met, Rul, Val>
    = { case: 'exp', exp: Exp<Met, Rul, Val> }
    | { case: 'zips', zips: List<Zip<Met, Rul, Val>> }
    | undefined

// top: the top of the select can move
// bot: the bot of the select can move
export type Orient = 'top' | 'bot'

// updateState

export function updateState<Met, Rul, Val, Dat>(f: EndoReadPart<Props<Met, Rul, Val, Dat>, State<Met, Rul, Val, Dat>>): EndoReadPart<Props<Met, Rul, Val, Dat>, State<Met, Rul, Val, Dat>> {
    return (pr, st) => {
        const st_ = f(pr, st)
        if (st_ === undefined) return undefined
        return st_
            .update('history', (hist) => hist.size < 500 ? hist.unshift(st) : hist)
            .set('future', List([]))
    }
}

export function updateMode<Met, Rul, Val, Dat>(f: EndoPart<Mode<Met, Rul, Val>>): EndoReadPart<Props<Met, Rul, Val, Dat>, State<Met, Rul, Val, Dat>> {
    return (pr, st) => {
        return st
            .update('mode', (mode) => f(mode) ?? mode)
            .update('history', (hist) => hist.size < 500 ? hist.unshift(st) : hist)
            .set('future', List([]))
    }
}

export function undo<Met, Rul, Val, Dat>(): EndoReadPart<Props<Met, Rul, Val, Dat>, State<Met, Rul, Val, Dat>> {
    return (pr, st) => {
        const st_ = st.history.get(0)
        if (st_ === undefined) return undefined
        return st_
            .update('future', futr => futr.size < 500 ? futr.unshift(st) : futr)
    }
}

export function redo<Met, Rul, Val, Dat>(): EndoReadPart<Props<Met, Rul, Val, Dat>, State<Met, Rul, Val, Dat>> {
    return (pr, st) => {
        const st_ = st.future.get(0)
        if (st_ === undefined) return undefined
        return st_
            .update('history', hist => hist.size < 500 ? hist.unshift(st) : hist)
    }
}

export function getStateMet<Met, Rul, Val, Dat>(gram: Grammar<Met, Rul, Val>, st: State<Met, Rul, Val, Dat>): Met {
    return getModeMet(gram, st.mode)
}

export function getZipsBot<Met, Rul, Val>(select: Select<Met, Rul, Val>) {
    return toZipsBot(select.orient, select.zipsBot)
}

export function setZipsBot<Met, Rul, Val>(select: Select<Met, Rul, Val>, zips: List<Zip<Met, Rul, Val>>) {
    return { ...select, zipsBot: toZipsBot(select.orient, zips) }
}

export function toZipsBot<Met, Rul, Val>(orient: Orient, zips: List<Zip<Met, Rul, Val>>) {
    switch (orient) {
        case 'top': return zips.reverse()
        case 'bot': return zips
    }
}

export function getModeMet<Met, Rul, Val, Dat>(
    gram: Grammar<Met, Rul, Val>,
    mode: Mode<Met, Rul, Val>
): Met {
    switch (mode.case) {
        case 'cursor': return mode.cursor.exp.met
        case 'select': return mode.select.exp.met
    }
}

export function buildInterpretQueryString<Met, Rul, Val, Dat>(
    gram: Grammar<Met, Rul, Val>,
    parse: (met: Met, str: string) => { rul: Rul, val: Val } | undefined
) {
    return (
        st: State<Met, Rul, Val, Dat>,
        str: string
    ): Action<Met, Rul, Val>[] => {
        if (str === "") return []
        const met = getModeMet(gram, st.mode)
        const res = parse(met, str)
        if (res === undefined) return []
        const { rul, val } = res
        const kids = gram.kids(rul)
        if (kids.length === 0) {
            switch (st.mode.case) {
                case 'cursor': return [{
                    case: 'replace-exp',
                    exp: makeExpTemplate(gram, met, rul, val)
                }]
                case 'select': return []
            }
        }
        else {
            const zips = makeZipTemplates(gram, met, rul, val, (() => {
                switch (st.mode.case) {
                    case 'cursor': return st.mode.cursor.exp.met
                    case 'select': return st.mode.select.exp.met
                }
            })())
            return zips.map(zip => ({
                case: 'insert',
                zips: List([zip])
            }))
        }
    }
}

function formatNodeStyle<Met, Rul, Val, Dat, Env>
    (
        style: NodeStyle<Met, Rul, Val, Dat>,
        expNode_: (env: Env) => ExpNode<Met, Rul, Val, Dat>
    ): (env: Env) => ExpNode<Met, Rul, Val, Dat> {
    return (env) => {
        const expNode = expNode_(env)
        return ({
            exp: expNode.exp,
            nodes: expNode.nodes.map(node => ({ ...node, style }))
        })
    }
    // ({ ...expNode(env), style })
}

// TODO: pull back custom Envs to a general interface
type Env<Met, Rul, Val, Dat> = RecordOf<{
    st: State<Met, Rul, Val, Dat>,
    indentationLevel: number,
    zips: List<Zip<Met, Rul, Val>>
}>

// TODO: what was this supposed to do?
// function formatPre<Met, Rul, Val, Dat>() {}

// buildBackend

export function buildBackend<Met, Rul, Val, Dat, Env>(
    args: {
        language: Language<Met, Rul, Val>,
        isValidSelect: Props<Met, Rul, Val, Dat>['isValidSelect'], // is this necessary, or can be abstracted to Language?
        initExp: Exp<Met, Rul, Val>,
        // actions
        interpretQueryString: Props<Met, Rul, Val, Dat>['interpretQueryString'],
        interpretKeyboardCommandEvent: Props<Met, Rul, Val, Dat>['interpretKeyboardCommandEvent'],
        // formatting
        makeInitEnv: (st: State<Met, Rul, Val, Dat>) => Env,
        formatExp: (st: State<Met, Rul, Val, Dat>, exp: Exp<Met, Rul, Val>, zipPar: Zip<Met, Rul, Val> | undefined) => (env: Env) => ExpNode<Met, Rul, Val, Dat>,
        formatZip: (st: State<Met, Rul, Val, Dat>, zips: List<Zip<Met, Rul, Val>>, zipPar: Zip<Met, Rul, Val> | undefined) => (kid: (env: Env) => ExpNode<Met, Rul, Val, Dat>) => (env: Env) => ExpNode<Met, Rul, Val, Dat>
    },
): Backend<Met, Rul, Val, Dat> {
    function cut(): EndoReadPart<Props<Met, Rul, Val, Dat>, State<Met, Rul, Val, Dat>> {
        return updateState((pr, st): State<Met, Rul, Val, Dat> | undefined => {
            const met = getStateMet(pr.language.grammar, st)
            switch (st.mode.case) {
                case 'cursor': return st
                    .set('mode', { case: 'cursor', cursor: { zips: st.mode.cursor.zips, exp: makeHole(pr.language.grammar, met) } })
                    .set('clipboard', { case: 'exp', exp: st.mode.cursor.exp })

                case 'select':
                    if (!args.isValidSelect(st.mode.select)) return undefined
                    return st
                        .set('mode', { case: 'cursor', cursor: { zips: st.mode.select.zipsTop, exp: st.mode.select.exp } })
                        .set('clipboard', { case: 'zips', zips: getZipsBot(st.mode.select) })
            }
        })
    }

    function copy(): EndoReadPart<Props<Met, Rul, Val, Dat>, State<Met, Rul, Val, Dat>> {
        return updateState((pr, st): State<Met, Rul, Val, Dat> | undefined => {
            switch (st.mode.case) {
                case 'cursor': return st
                    .set('clipboard', { case: 'exp', exp: st.mode.cursor.exp })

                case 'select':
                    if (!args.isValidSelect(st.mode.select)) return undefined
                    return st
                        .set('clipboard', { case: 'zips', zips: getZipsBot(st.mode.select) })
            }
        })
    }

    function paste(): EndoReadPart<Props<Met, Rul, Val, Dat>, State<Met, Rul, Val, Dat>> {
        return updateState((pr, st): State<Met, Rul, Val, Dat> | undefined => {
            if (st.clipboard === undefined) return undefined
            switch (st.clipboard.case) {
                case 'exp': {
                    switch (st.mode.case) {
                        case 'cursor': return st.set('mode', { case: 'cursor', cursor: { zips: st.mode.cursor.zips, exp: st.clipboard.exp } })
                        case 'select': return undefined
                    }
                }
                case 'zips': {
                    switch (st.mode.case) {
                        case 'cursor':
                            if (!args.isValidSelect({ zipsTop: st.mode.cursor.zips, zipsBot: toZipsBot('bot', st.clipboard.zips), exp: st.mode.cursor.exp, orient: 'bot' })) return undefined
                            return st.set('mode', { case: 'cursor', cursor: { zips: st.clipboard.zips.concat(st.mode.cursor.zips), exp: st.mode.cursor.exp } })
                        case 'select':
                            if (!args.isValidSelect({ zipsTop: st.mode.select.zipsTop, zipsBot: toZipsBot('bot', st.clipboard.zips), exp: st.mode.select.exp, orient: 'bot' })) return undefined
                            return st.set('mode', { case: 'cursor', cursor: { zips: st.clipboard.zips.concat(st.mode.select.zipsTop), exp: st.mode.select.exp } })
                    }
                }
            }
        })
    }

    return {
        props: {
            ...args,
            format: (st, query) => {
                const initEnv = args.makeInitEnv(st)

                const acts: Action<Met, Rul, Val>[] | undefined =
                    query.str.length > 0 ?
                        args.interpretQueryString(st, query.str) :
                        undefined
                const act =
                    acts !== undefined && acts.length > 0 ?
                        acts[query.i % acts.length] :
                        undefined
                const zipParQuery =
                    act !== undefined && act.case === 'insert' ?
                        act.zips.get(0) :
                        undefined

                function formatQueryAround(kid: (env: Env) => ExpNode<Met, Rul, Val, Dat>, zipPar: Zip<Met, Rul, Val> | undefined): (env: Env) => ExpNode<Met, Rul, Val, Dat> {
                    if (query.str === "")
                        return kid
                    else if (act === undefined) {
                        return formatNodeStyle({ case: 'query-invalid', string: query.str }, kid)
                    } else {
                        switch (act.case) {
                            case 'replace-exp':
                                return (env) => {
                                    const expNode_new = formatNodeStyle({ case: 'query-replace-new' }, args.formatExp(st, act.exp, zipPar))(env)
                                    const expNode_old = formatNodeStyle({ case: 'query-replace-old' }, kid)(env)
                                    return ({
                                        exp: expNode_new.exp,
                                        nodes: [expNode_new.nodes, expNode_old.nodes].flat()
                                    })
                                }
                            case 'insert':
                                return formatNodeStyle({ case: 'query-insert-top' },
                                    args.formatZip(st, act.zips, zipPar)
                                        (formatNodeStyle({ case: 'query-insert-bot' },
                                            kid)))
                            default:
                                // TODO: special display for other kinds of actions?
                                return kid
                        }
                    }
                }

                switch (st.mode.case) {
                    case 'cursor': {
                        st.mode.cursor.zips.get(0)
                        return args.formatZip(st, st.mode.cursor.zips, undefined)
                            (formatQueryAround(
                                formatNodeStyle({ case: 'cursor' },
                                    args.formatExp(st, st.mode.cursor.exp, zipParQuery ?? st.mode.cursor.zips.get(0))),
                                st.mode.cursor.zips.get(0)
                            ))(initEnv).nodes
                    }
                    case 'select':
                        const isValid = args.isValidSelect(st.mode.select)
                        return args.formatZip(st, st.mode.select.zipsTop, undefined)
                            (formatQueryAround(
                                formatNodeStyle({ case: 'select-top', isValid },
                                    args.formatZip(st, getZipsBot(st.mode.select), zipParQuery ?? st.mode.select.zipsTop.get(0))
                                        (formatNodeStyle({ case: 'select-bot', isValid },
                                            args.formatExp(st, st.mode.select.exp, getZipsBot(st.mode.select).get(0))
                                        ))
                                ),
                                st.mode.select.zipsTop.get(0)
                            ))(initEnv).nodes
                }
            },

            handleAction: (act: Action<Met, Rul, Val>): EndoReadPart<Props<Met, Rul, Val, Dat>, State<Met, Rul, Val, Dat>> => {
                switch (act.case) {
                    case 'replace-exp': {
                        return updateMode(mode => {
                            switch (mode.case) {
                                case 'cursor':
                                    return {
                                        case: 'cursor',
                                        cursor: {
                                            zips: mode.cursor.zips,
                                            exp: act.exp
                                        }
                                    }
                                // can't replace a select with an exp
                                case 'select': return undefined
                            }
                        })
                    }
                    case 'replace-zips': {
                        return updateMode(mode => {
                            switch (mode.case) {
                                case 'cursor':
                                    return {
                                        case: 'cursor',
                                        cursor: {
                                            zips: act.zips,
                                            exp: mode.cursor.exp
                                        }
                                    }
                                case 'select':
                                    return {
                                        case: 'cursor',
                                        cursor: {
                                            zips: act.zips.concat(mode.select.zipsTop),
                                            exp: mode.select.exp
                                        }
                                    }
                            }
                        })
                    }
                    case 'insert': {
                        return updateMode((mode): Mode<Met, Rul, Val> => {
                            switch (mode.case) {
                                case 'cursor': return {
                                    case: 'cursor',
                                    cursor: {
                                        zips: act.zips.concat(mode.cursor.zips),
                                        exp: mode.cursor.exp // wrapZipExp(act.zips, mode.cursor.exp)
                                    }
                                }
                                // TODO: probably disable this and don't allow queries to start during a select
                                case 'select': return {
                                    case: 'select',
                                    select: setZipsBot(mode.select, act.zips)
                                }
                            }
                        })
                    }
                    case 'move_cursor': return updateMode((mode) => moveCursor(args.language.grammar, act.dir, mode))
                    case 'move_select': return updateMode((mode) => moveSelect(args.language.grammar, act.dir, mode))
                    case 'delete': {
                        return updateMode((mode): Mode<Met, Rul, Val> | undefined => {
                            const met = getModeMet(args.language.grammar, mode)
                            switch (mode.case) {
                                case 'cursor': {
                                    return {
                                        case: 'cursor',
                                        cursor: {
                                            zips: mode.cursor.zips,
                                            exp: makeHole(args.language.grammar, met)
                                        }
                                    }
                                }
                                case 'select': {
                                    if (!args.isValidSelect(mode.select)) return undefined
                                    return {
                                        case: 'cursor',
                                        cursor: {
                                            zips: mode.select.zipsTop,
                                            exp: mode.select.exp
                                        }
                                    }
                                }
                            }
                        })
                    }
                    case 'escape': return updateMode((mode): Mode<Met, Rul, Val> | undefined => {
                        return { case: 'cursor', cursor: enterCursor(args.language.grammar, mode) }
                    })
                    case 'cut': return cut()
                    case 'copy': return copy()
                    case 'paste': return paste()
                    case 'undo': return undo()
                    case 'redo': return redo()
                    case 'set_cursor': {
                        return updateMode((mode): Mode<Met, Rul, Val> => ({
                            case: 'cursor',
                            cursor: act.cursor
                        }))
                    }
                    case 'set_select': {
                        return updateMode((mode): Mode<Met, Rul, Val> => ({
                            case: 'select',
                            select: act.select
                        }))
                    }
                }
            }
        },

        state: makeState({
            mode: { case: 'cursor', cursor: { zips: List([]), exp: args.initExp } },
            clipboard: undefined,
            history: List([]),
            future: List([])
        })
    }
}

