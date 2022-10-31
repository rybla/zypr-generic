import { List } from 'immutable';
import React from 'react';
import './App.css';
import { Direction, directionFromKey } from './zypr-generic/Direction';
import { Editor, escapeSelect, displayEditor, interactEditorQuery, escapeQuery, moveEditorSelect, moveEditorCursor, backspaceEditor } from './zypr-generic/Editor';
import { displayExpression } from './zypr-generic/Grammar';
import { editorInit, Meta, Rule } from './zypr-generic/languages/Lang1';
import { fixZipBot } from './zypr-generic/Selection';
import { displayZipper } from './zypr-generic/Zipper';

type Meta = Meta;
type Rule = Rule;

type AppProps = {}

type AppState = {
  editor: Editor<Meta, Rule>,
  history: List<Editor<Meta, Rule>>,
  future: List<Editor<Meta, Rule>>
}

export default class App extends React.Component<AppProps, AppState> {
  state = {
    editor: editorInit,
    history: List<Editor<Meta, Rule>>(),
    future: List<Editor<Meta, Rule>>()
  }

  updateEditor(f: (editor: Editor<Meta, Rule>) => Editor<Meta, Rule> | undefined, notarize: boolean = true): void {
    const editor: Editor<Meta, Rule> | undefined = f(this.state.editor)
    if (editor === undefined) return;
    this.setState({
      ...this.state,
      editor: editor,
      history: notarize ?
        this.state.history.unshift(this.state.editor).take(100) :
        this.state.history,
      future: List()
    });
  }

  undoEditor() {
    let editor = this.state.history.get(0);
    if (editor === undefined) return;
    this.setState({
      ...this.state,
      editor: editor,
      history: this.state.history.shift(),
      future: this.state.future.unshift(this.state.editor)
    });
  }

  redoEditor() {
    let editor = this.state.future.get(0);
    if (editor === undefined) return;
    this.setState({
      ...this.state,
      editor: editor,
      history: this.state.history.unshift(this.state.editor),
      future: this.state.future.shift()
    })
  }

  keyboardEventListener = (event: KeyboardEvent): any => {
    console.log(event.key);
    if (event.key === 'Shift') { }
    else if (directionFromKey(event.key)) {
      let dir = directionFromKey(event.key) as Direction;
      if (
        (dir === 'left' || dir === 'right') &&
        this.state.editor.mode.case === 'cursor' &&
        this.state.editor.mode.query !== undefined
      ) {
        this.updateEditor(interactEditorQuery(event));
      } else if (event.shiftKey) {
        this.updateEditor(moveEditorSelect(dir));
      } else {
        this.updateEditor(moveEditorCursor(dir));
      }
      event.preventDefault();
    } else if (event.key === 'Escape') {
      switch (this.state.editor.mode.case) {
        case 'cursor': {
          if (this.state.editor.mode.query !== undefined) {
            this.updateEditor(escapeQuery);
            event.preventDefault();
          }
          break;
        }
        case 'select': {
          this.updateEditor(escapeSelect);
          event.preventDefault();
          break;
        }
      }
    } else if (event.key === 'Enter') {
      this.updateEditor(interactEditorQuery(event));
      event.preventDefault();
    } else if (event.key === 'Tab') {
      // TODO
      event.preventDefault();
    } else if (event.key === 'Backspace') {
      if (
        this.state.editor.mode.case === 'cursor' &&
        this.state.editor.mode.query !== undefined
      ) {
        this.updateEditor(interactEditorQuery(event))
      } else {
        this.updateEditor(backspaceEditor as (editor: Editor<Meta, Rule>) => Editor<Meta, Rule> | undefined);
      }
      event.preventDefault()
    } else if (event.ctrlKey) {
      if (event.key === 'z') {
        this.undoEditor();
        event.preventDefault();
      } else if (event.key === 'Z') {
        this.redoEditor();
        event.preventDefault();
      }
      // TODO: cut/copy/paste
    } else if (event.altKey) {
      // TODO
      event.preventDefault();
    } else {
      this.updateEditor(interactEditorQuery(event));
      event.preventDefault();
    }
  }

  componentDidMount(): void {
    document.addEventListener('keydown', this.keyboardEventListener)
  };

  componentWillUnmount(): void {
    document.removeEventListener('keydown', this.keyboardEventListener);
  }

  render() {
    return (
      <div className='app'>
        <div className='editor'>
          <div className='editor-inner'>
            {displayEditor(this.state.editor, this.state.editor.renderer)}
          </div>
        </div>
        {this.renderConsole()}
      </div>
    );
  }

  renderConsole(): JSX.Element {
    let editorHtml = (
      <span className="code">
        {displayEditor(this.state.editor, this.state.editor.printer)}
      </span>
    );
    let modeHtml: JSX.Element;
    const grammarDisplayer = this.state.editor.printer.grammarDisplayer;
    switch (this.state.editor.mode.case) {
      case 'cursor': {
        const cursor = this.state.editor.mode.cursor;
        const query = this.state.editor.mode.query;
        modeHtml = (
          <table>
            <tbody>
              <tr>
                <td><span className="table-key">zipper</span></td>
                <td><span className="code">{displayZipper(grammarDisplayer, cursor.zip)({ exp: cursor.exp, out: "@" }).out}</span></td>
              </tr>
              <tr>
                <td><span className="table-key">expression</span></td>
                <td><span className="code">{displayExpression(grammarDisplayer, cursor.exp).out}</span></td>
              </tr>
              <tr>
                <td><span className="table-key">query</span></td>
                <td><span className="code">{query !== undefined ? query.str : "no query"}</span></td>
              </tr>
            </tbody>
          </table>
        );
        break;
      }
      case 'select': {
        const select = this.state.editor.mode.select;
        modeHtml = (
          <table>
            <tbody>
              <tr>
                <td><span className="table-key">top zipper</span></td>
                <td><span className="code">{displayZipper(grammarDisplayer, select.zipTop)({ exp: select.exp, out: "@" }).out}</span></td>
              </tr>
              <tr>
                <td><span className="table-key">bot zipper</span></td>
                <td><span className="code">{displayZipper(grammarDisplayer, fixZipBot(select.orient, select.zipBot))({ exp: select.exp, out: "@" }).out}</span></td>
              </tr>
              <tr>
                <td><span className="table-key">expression</span></td>
                <td><span className="code">{displayExpression(grammarDisplayer, select.exp).out}</span></td>
              </tr>
            </tbody>
          </table>
        )
      }
    }
    return (
      <div className="console">
        <table>
          <tbody>
            <tr>
              <td><span className="table-key">editor</span></td>
              <td>{editorHtml}</td>
            </tr>
            <tr>
              <td><span className="table-key">mode</span></td>
              <td>{modeHtml}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }
}
