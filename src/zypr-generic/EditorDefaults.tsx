import { List } from "immutable"
import { mod } from "../Number"
import { Cursor } from "./Cursor"
import { EditorDisplayer, EditorQuery, EditorQueryHandler, EditorQueryResult, EditorQueryResultInsert } from "./Editor"
import { displayExpression, Expression, Grammar, GrammarDisplayer, GrammarDisplayerOut, makeExpression, makeHole } from "./Grammar"
import { M } from "./languages/Lang1"
import { Select } from "./Selection"
import { displayZipper, makeStep } from "./Zipper"

// printing

export function defaultEditorPrinter
  <M extends string, R extends string, D, E>(
    grammar: Grammar<M, R, D>,
    grammarPrinter: GrammarDisplayer<M, R, D, string, E>,
    displayerEnvInit: E
  ):
  EditorDisplayer<M, R, D, string, E> {
  return {
    grammarDisplayer: grammarPrinter,
    displayCursorExp: (cursor, res) => (out) => env => ["{"].concat(out(env)).concat(["}"]),
    displaySelectTop: (select) => (out) => env => ["[0]{"].concat(out(env)).concat(["}[0]"]),
    displaySelectBot: (select) => (out) => env => ["[1]{"].concat(out(env)).concat(["}[1]"]),
    displayerEnvInit
  }
}

// rendering

export function defaultEditorRenderer<M extends string, R extends string, D, E>
  (
    grammar: Grammar<M, R, D>,
    grammarRenderer: GrammarDisplayer<M, R, D, JSX.Element, E>,
    displayerEnvInit: E
  ):
  EditorDisplayer<M, R, D, JSX.Element, E> {
  return {
    displayerEnvInit,
    grammarDisplayer: grammarRenderer,
    displayCursorExp: (cursor, res) =>
      (out: GrammarDisplayerOut<JSX.Element, E>) => {
        switch (res.case) {
          case 'insert': return env => {
            const zipRen = displayZipper<M, R, D, JSX.Element, E>(grammar, grammarRenderer, res.zip)({
              exp: cursor.exp,
              out: env => [<div className="query-out">{out(env)}</div>]
            })
            return [<div className="cursor"><div className="query"><div className="query-result query-result-insert" >{zipRen.out(env)}</div></div></div>]
          }
          case 'replace': return env => {
            const expRen = displayExpression(grammarRenderer, res.exp)
            return [<div className="cursor"><div className="query"><div className="query-result query-result-replace">{expRen.out(env)}</div><div className="query-out">{out(env)}</div></div></div>]
          }
          case 'invalid': return env => [<div className="cursor"><div className="query"><div className="query-result query-result-invalid">{res.str}</div><div className="query-out">{out(env)}</div></div></div>]
          case 'no query': return env => [<div className="cursor">{out(env)}</div>]
        }
      },
    displaySelectTop: (select) => (out) => env => [<div className="select select-top">{out(env)}</div>],
    displaySelectBot: (select) => (out) => env => [<div className="select select-bot">{out(env)}</div>],
  }
}

// query handling

export function defaultQueryHandler<M extends string, R extends string, D, E>
  (
    grammar: Grammar<M, R, D>,
    inserts: { [rule in R]: ((cursor: Cursor<M, R, D>, str: string) => boolean) | undefined },
    replaces: { [rule in R]: ((cursor: Cursor<M, R, D>, str: string) => D | undefined) | undefined }
  ):
  EditorQueryHandler<M, R, D, E> {
  return (cursor, query) => {
    const meta = cursor.exp.meta;
    const rules = grammar.rules[meta]

    // no query
    if (query === undefined) return { case: 'no query' }

    // insert
    for (const rule of rules) {
      const insert = inserts[rule]
      if (insert === undefined || !insert(cursor, query.str)) continue
      let results: EditorQueryResultInsert<M, R, D, E>[] = []
      // for each kid with the same meta as cursor.exp
      const kids_metas = grammar.kids[rule]
      kids_metas.map((kid_meta, i) => {
        if (kid_meta !== cursor.exp.meta) return
        results.push({
          case: 'insert',
          zip: List([
            makeStep<M, R, D>({
              meta,
              rule,
              data: grammar.data[rule],
              leftsRev: kids_metas.slice(undefined, i)
                .map(meta => makeHole(grammar, meta)),
              rights: kids_metas.slice(i + 1, undefined)
                .map(meta => makeHole(grammar, meta))
            })
          ])
        })
      })
      if (results.length === 0) return { case: 'invalid', str: query.str }
      return results[mod(query.i, results.length)]
    }

    // replace
    for (const rule of rules) {
      const kidMetas = grammar.kids[rule]
      const replace = replaces[rule]
      if (replace === undefined) continue
      const data = replace(cursor, query.str)
      if (data === undefined) continue
      const exp = makeExpression(grammar,
        {
          meta, rule, data,
          kids: kidMetas.map(kidMeta => makeHole(grammar, kidMeta))
        })
      return { case: 'replace', exp }
    }

    // invalid
    return { case: 'invalid', str: query.str }
  }
}