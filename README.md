# HAKBa — Human-AI Knowledge Base

人間が理解・納得した Knowledge と、外部情報・AI の提案を区別して管理するツールキットです。[コンセプト](concept.md) に基づき、VSCode 拡張機能と共通 agent skill を提供します。

## 開発・ローカル導入

Node.js 22.12 以降、npm、Git、デスクトップ VSCode 1.95 以降が必要です。ローカルの信頼済み Git リポジトリで動作します。SSH / Dev Container では拡張機能をリポジトリと同じ環境にインストールしてください。

```sh
cd extension
npm ci
npm run check
npm test
npm run test:integration
npm run package
code --install-extension hakba-0.1.0.vsix
```

Linux の画面がない環境では `xvfb-run -a npm run test:integration` を使います。Integration テストは初回に VSCode をダウンロードします。既存のテスト用デスクトップ VSCode は `HAKBA_VSCODE_EXECUTABLE` で指定できます。

開発時は `npm run compile` の後、リポジトリを VSCode で開いて F5（Run HAKBa）を実行します。

## 使い方

Git リポジトリを開き、コマンドパレットまたは Explorer の右クリックから次を実行します。

| コマンド | 操作 |
| --- | --- |
| HAKBa: Initialize Repository | ルートに Space の不足構造を追加。既存の情報は保持 |
| HAKBa: Create Child Space | 選択位置を含む最も近い Space の子として `yymmdd_名前/` を作成 |
| HAKBa: Create Classified Markdown | Space・分類を選び、Markdown を作成 |
| HAKBa: Approve Current Knowledge | 内容を表示し、明示確認後に `draft: false` に変更 |
| HAKBa: Refresh Git Dates | Git 日付のキャッシュを更新 |

Explorer で対象を指定しない場合は現在のファイルを使い、それもなければ最初の workspace folder を使います。複数リポジトリを開いている場合は対象のファイルまたはフォルダを選択してください。

```text
_index.md
_contexts/
_sources/
_knowledges/
_outputs/
261018_project/
  _index.md
  _contexts/
  _sources/
  _knowledges/
  _outputs/
```

Knowledge は Markdown とし、新規作成時は `draft: true` です。分類ディレクトリ内のサブディレクトリも同じ分類です。Source と Output は通常の VSCode 操作で任意形式のファイルを配置できます。

### リンク

```md
[[261018_project/_knowledges/判断.md]]
[[261018_project/_sources/日本語 空白.csv|データ]]
[[261018_project/_sources/diagram.png]]
```

パスは Git リポジトリルートからの相対パスで、拡張子を必ず含めます。入力中に既存ファイルの候補が表示され、Command/Ctrl＋クリックで開けます。`.git` と Git ignore 対象は候補から除外します。存在しない `.md` は分類に対応した内容で新規作成し、他形式は「見つからない」と通知します。既存ファイルを上書きしません。

コードブロック・インラインコードはリンク処理しません。見出しリンク、標準 Markdown リンクのルート基準化、ファイル移動時のリンク自動更新は v1 では提供しません。Wiki リンクのクリック・補完は Markdown ソースエディタ向けで、プレビューのリンク変換は行いません。

### 日付・承認

Markdown の先頭の CodeLens に Git の作成日・更新日を表示します。CodeLens を有効にしてください。現在の HEAD から辿れる rename 追跡付きの履歴を使い、最古と最新の該当コミットの committer 日時を表示します。rebase 等による履歴変更で日時が変わる場合があります。未コミットの編集は反映せず、浅い clone は取得範囲の履歴であることを表示します。表示は Git 状態変更・ウィンドウ再フォーカス・手動更新で再取得します。

承認コマンドはファイル全体を承認します。AI と人間の編集は自動識別しません。手編集は承認状態を維持し、AI は skill の規則で編集時に draft 化します。拡張機能は参照スコープや承認状態を強制するセキュリティ境界ではありません。

## Agent skill の導入

`skills/hakba/` ディレクトリ全体を、利用する agent の skill ディレクトリにコピーしてください。

- Codex：`$CODEX_HOME/skills/hakba/`（未設定なら `~/.codex/skills/hakba/`）
- Claude Code：プロジェクトの `.claude/skills/hakba/` またはユーザーの `~/.claude/skills/hakba/`

Codex では `$hakba`、Claude Code では `/hakba`、または HAKBa での管理を依頼して利用します。skill の本体は特定 agent の API に依存しません。HAKBa の skill は [composable-skill-design](.agents/skills/composable-skill-design/SKILL.md) に沿った Context Skill で、分類・参照範囲・承認・保守の規則と不変条件を提供します。作業の目的・成果・手順・報告方法は、ユーザーの依頼や併用する Process Skill が定めます。特定の Process Skill への依存はありません。

Output の根拠にできるのは、自身と祖先の Context・承認済み Knowledge のみです。Source、draft、兄弟・子孫 Space の Knowledge を直接使いません。AI の Knowledge 編集は必ず draft に戻し、ユーザーによる対象内容の明示的な承認を経て Output に利用します。

## Marketplace 公開準備

公開は自動実行しません。`hakba-local` はローカルビルド用 publisher ID です。

1. Marketplace で publisher を作成し、`extension/package.json` の `publisher` を実際の ID に変更します。テストの拡張 ID も合わせて変更します。
2. 公開先を決めたら `repository`・`homepage`・`bugs` を追加し、名前の利用可否、ライセンス、README、128px アイコン、バージョンを確認します。
3. `npm ci`、`npm run check`、`npm test`、`npm run test:integration` を実行します。承認の確認ダイアログ、Space・分類選択、日付更新も Extension Development Host で確認します。
4. `npm run package` で VSIX を生成し、`npx vsce ls` で同梱物を確認します。別のプロファイルに VSIX をインストールして動作確認します。
5. 公開権限・認証を設定した後、公開を判断した担当者が `npx vsce publish` を実行します。トークンをリポジトリに保存しないでください。

新規コードは MIT License。依存ライブラリのライセンスは VSIX 内に同梱されます。
