import { List, Record, RecordOf } from "immutable";
import { debug } from "../../Debug";
import * as Backend from "../Backend";
import { eqZip, eqZips, Grammar, makeHole, unzipsExp, zipExp } from "../Language";
import { Pre, Exp, Zip, Met, Rul, Val, AppVal } from "../language/LanguageBeta";
import { Node, ExpNode } from "../Node";

type Env = RecordOf<{
    st: Backend.State<Met, Rul, Val, Dat>,
    indentationLevel: number,
    zips: List<Zip>,
}>

export type Dat = {
    pre: Pre,
    indent: number | undefined,
    isParenthesized: boolean,
}

export default function backend(
    { grammar }:
        { grammar: Grammar<Met, Rul, Val>; }
): Backend.Backend<Met, Rul, Val, Dat> {

    function isValidSelect(select: Backend.Select<Met, Rul, Val>): boolean {
        // TODO: modify when there are lambdas with ids
        return true
    }

    const makeInitEnv = (st: Backend.State<Met, Rul, Val, Dat>): Env => Record({
        st,
        indentationLevel: 0,
        zips: List([])
    })()

    function nextEnv(
        zipPar: Zip | undefined,
        env: Env
    ): Env {
        if (zipPar === undefined) return env
        const env_ = env.update('zips', zips => zips.unshift(zipPar))
        switch (zipPar.rul) {
            case 'bnd': return env_
            case 'var': return env_
            case 'app': return env_.update('indentationLevel', (i) => isArg(zipPar) ? i + 1 : i)
            case 'lam': return env_.update('indentationLevel', (i) => isBod(zipPar) ? i + 1 : i)
            case 'hol': return env_
        }
    }

    function escapeSelect(
        select: Backend.Select<Met, Rul, Val>
    ): Backend.Cursor<Met, Rul, Val> {
        switch (select.orient) {
            case 'top': return {
                zips: select.zipsTop,
                exp: unzipsExp(grammar, select.zipsBot.reverse(), select.exp)
            }
            case 'bot': return {
                zips: select.zipsBot.concat(select.zipsTop),
                exp: select.exp
            }
        }
    }

    const formatPre = (
        st: Backend.State<Met, Rul, Val, Dat>,
        exp: Exp,
        pre: Pre,
        env: Env,
        kids: ExpNode<Met, Rul, Val, Dat>[],
        zipPar: Zip | undefined
    ): Node<Met, Rul, Val, Dat> => {
        const select = (() => {
            const cursor1: Backend.Cursor<Met, Rul, Val> = (() => {
                switch (env.st.mode.case) {
                    case 'cursor': return env.st.mode.cursor
                    case 'select': return escapeSelect(env.st.mode.select)
                }
            })()
            const cursor2: Backend.Cursor<Met, Rul, Val> = { zips: env.zips, exp }
            return getSelectBetweenCursor(cursor1, cursor2)
        })()

        return {
            case: 'exp',
            dat: {
                pre,
                isParenthesized:
                    ((isArg(zipPar) || isBod(zipPar)) && (pre.rul === 'app' || pre.rul === 'lam')) ||
                    (zipPar?.rul !== 'app' && pre.rul === 'app'),
                indent: ((): number | undefined => {
                    return (
                        (
                            zipPar !== undefined &&
                            zipPar.rul === 'app' &&
                            (zipPar.val as AppVal).indentedArg
                        )
                            ? env.indentationLevel
                            : undefined)
                })()
            },
            kids: kids.map(kid => kid.node),
            // NOTE: will still work when eqZips(st.mode.cursor.zips, env.zips)
            getCursor: () => ({ zips: env.zips, exp }),
            isCursorable:
                (st.mode.case === 'cursor' && eqZips(st.mode.cursor.zips, env.zips))
                    ? 'same'
                    : 'true',
            // getSelect: () => {
            //     const cursor1: Backend.Cursor<Met, Rul, Val> = (() => {
            //         switch (env.st.mode.case) {
            //             case 'cursor': return env.st.mode.cursor
            //             case 'select': return escapeSelect(env.st.mode.select)
            //         }
            //     })()
            //     const cursor2: Backend.Cursor<Met, Rul, Val> = { zips: env.zips, exp }
            //     return getSelectBetweenCursor(cursor1, cursor2)
            // },
            getSelect: () =>
                select === 'empty' ? 'empty' :
                    select,
            isSelectable:
                select === 'empty' ? 'empty' :
                    select === undefined ? 'false' :
                        select.orient === 'top' ? 'bot' : 'top'
            // isSelectableTop:
            //     select === 'empty' ? 'empty' :
            //         select !== undefined ? select.orient === 'bot' :
            //             false,
            // isSelectableBot:
            //     select === 'empty' ? 'empty' :
            //         select !== undefined ? select.orient === 'top' :
            //             false
            // !(select === undefined || select === 'empty') && select.orient === 'bot',
            // isSelectableBot: !(select === undefined || select === 'empty') && select.orient === 'top'
        }
    }

    const defined = <A>(a: A | undefined): A => a as A

    const formatExp = (
        st: Backend.State<Met, Rul, Val, Dat>,
        exp: Exp,
        zipPar: Zip | undefined
    ) => (env: Env): ExpNode<Met, Rul, Val, Dat> => {
        switch (exp.rul) {
            case 'bnd': return {
                exp,
                node: formatPre(st, exp, exp, env, [], zipPar)
            }
            case 'var': return {
                exp,
                node: formatPre(st, exp, exp, env, [], zipPar)
            }
            case 'app': {
                const kids = exp.kids.map((kid, i) =>
                    formatExp(st, kid, defined(zipExp(grammar, exp, i)).zip)
                        (nextEnv(defined(zipExp(grammar, exp, i)).zip, env)))
                    .toArray()
                return {
                    exp,
                    node: formatPre(st, exp, exp, env, kids, zipPar)
                }
            }
            case 'lam': {
                const kids = exp.kids.map((kid, i) =>
                    formatExp(st, kid, defined(zipExp(grammar, exp, i)).zip)
                        (nextEnv(defined(zipExp(grammar, exp, i)).zip, env)))
                    .toArray()
                return {
                    exp,
                    node: formatPre(st, exp, exp, env, kids, zipPar)
                }
            }
            case 'hol': return {
                exp,
                node: formatPre(st, exp, exp, env, [], zipPar)
            }
        }
    }

    // formatZip: (zips: ListZip<Met,Rul,Val>, zipPar: Childing<Zip<Met,Rul,Val>>) => (kid: (env: Env<Exp<Met,Rul,Val>, Zip<Met,Rul,Val>, Dat<Met,Rul,Val>>) => ExpNode<Exp,Zip<Met,Rul,Val>,Dat<Met,Rul,Val>>) => (env: Env<Exp<Met,Rul,Val>, Zip<Met,Rul,Val>, Dat<Met,Rul,Val>>) => ExpNode<Exp,Zip<Met,Rul,Val>,Dat<Met,Rul,Val>>,
    const formatZip =
        (st: Backend.State<Met, Rul, Val, Dat>, zips: List<Zip>, zipPar: Zip | undefined) =>
            (node: ((env: Env) => ExpNode<Met, Rul, Val, Dat>)): (env: Env) => ExpNode<Met, Rul, Val, Dat> => {
                const zip = zips.get(0)
                if (zip === undefined) {
                    return node
                } else {
                    return formatZip(st, zips.shift(), zipPar)((env): ExpNode<Met, Rul, Val, Dat> => {
                        const kid = node(nextEnv(zip, env))
                        const exp = unzipsExp(grammar, List([zip]), kid.exp)

                        // is reversed
                        const kidsLeft: ExpNode<Met, Rul, Val, Dat>[] =
                            zip.kidsLeft.reverse().map((kid, i) =>
                                formatExp(st, kid, defined(zipExp(grammar, exp, i)).zip)
                                    (nextEnv(defined(zipExp(grammar, exp, i)).zip, env))
                            ).toArray()

                        const kidsRight: ExpNode<Met, Rul, Val, Dat>[] =
                            zip.kidsRight.map((kid, i) =>
                                formatExp(st, kid, defined(zipExp(grammar, exp, i + zip.kidsLeft.size + 1)).zip)
                                    (nextEnv(defined(zipExp(grammar, exp, i + zip.kidsLeft.size + 1)).zip, env))
                            ).toArray()

                        const kids: ExpNode<Met, Rul, Val, Dat>[] =
                            ([] as ExpNode<Met, Rul, Val, Dat>[]).concat(
                                kidsLeft,
                                [kid],
                                kidsRight
                            )

                        return {
                            exp: exp,
                            node: formatPre(st, exp, zip, env, kids, zips.get(1) ?? zipPar)
                        }
                    })
                }
            }

    const interpretQueryString = Backend.buildInterpretQueryString(grammar,
        (met, str): { rul: Rul, val: Val } | undefined => {
            switch (met) {
                case 'bnd': return { rul: 'bnd', val: { label: str } }
                case 'exp': {
                    if (str === " ") return { rul: 'app', val: { indentedArg: false } }
                    else return { rul: 'var', val: { label: str } }
                }
            }
        }
    )

    function interpretKeyboardCommandEvent(st: Backend.State<Met, Rul, Val, Dat>, event: KeyboardEvent): Backend.Action<Met, Rul, Val> | undefined {
        if (event.ctrlKey || event.metaKey) {
            if (event.key === 'c') return { case: 'copy' }
            else if (event.key === 'x') return { case: 'cut' }
            else if (event.key === 'v') return { case: 'paste' }
            else if (event.key === 'Z') return { case: 'redo' }
            else if (event.key === 'z') return { case: 'undo' }
        }
        if (event.key === 'Tab') {
            event.preventDefault()
            debug(0, "event: Tag")
            switch (st.mode.case) {
                case 'cursor': {
                    const exp: Exp | undefined = (() => {
                        switch (st.mode.cursor.exp.rul) {
                            case 'app': {
                                debug(0, "event: Tag, st.mode.cursor.exp.rul: app")
                                const val = st.mode.cursor.exp.val as AppVal
                                return { ...st.mode.cursor.exp, dat: { ...val, indentedArg: !val.indentedArg } }
                            }
                            default: return undefined
                        }
                    })()
                    if (exp !== undefined) return { case: 'replace', exp: st.mode.cursor.exp }
                    else return undefined
                }
                case 'select': {
                    // TODO: indent everything in selection
                    return undefined
                }
            }
        }

        return undefined
    }

    const initExp: Exp = makeHole(grammar, 'exp')

    return Backend.buildBackend<Met, Rul, Val, Dat, Env>(
        {
            grammar: grammar,
            isValidSelect,
            makeInitEnv,
            formatExp,
            formatZip,
            interpretQueryString,
            interpretKeyboardCommandEvent,
            initExp
        })
}

// TODO: shouldn't it orient the other way sometimes??
export function getSelectBetweenCursor(
    cursorStart: Backend.Cursor<Met, Rul, Val>,
    cursorEnd: Backend.Cursor<Met, Rul, Val>
): Backend.Select<Met, Rul, Val> | 'empty' | undefined {
    function go(zipsStart: List<Zip>, zipsEnd: List<Zip>, up: List<Zip>):
        Backend.Select<Met, Rul, Val> | 'empty' | undefined {
        const zipStart = zipsStart.get(0)
        const zipEnd = zipsEnd.get(0)
        if (zipStart === undefined && zipEnd === undefined) {
            // same zips
            return 'empty'
        } else if (zipStart === undefined) {
            // zipsStart is a subzipper of (i.e. is above) zipsEnd
            return { zipsTop: up, zipsBot: zipsEnd, exp: cursorEnd.exp, orient: 'top' }
        } else if (zipEnd === undefined) {
            // zipsEnd is a subzipper of (i.e. is above) zipsStart
            return { zipsTop: up, zipsBot: zipsStart.reverse(), exp: cursorStart.exp, orient: 'bot' }
        } else if (eqZip(zipStart, zipEnd)) {
            // zips match, so recurse further
            return go(zipsStart.shift(), zipsEnd.shift(), up.unshift(zipStart))
        } else {
            // zips branch into different kids
            return undefined
        }
    }
    return go(cursorStart.zips.reverse(), cursorEnd.zips.reverse(), List([]))
}