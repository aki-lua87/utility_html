キャスト飛距離ログ — PWA版

公開URL:
https://aki-lua87.github.io/utility_html/cast-distance/

1. cast-distance/ をリポジトリ直下に置き、GitHub Pagesで公開。
   ビルド不要。既存のHTMLツールと同じ構成です。
2. AndroidのChromeで公開URLを開き、メニュー →「アプリをインストール」または「ホーム画面に追加」。
3. 「オフライン起動の準備ができました」と表示されたら、オフライン起動にも対応。
   インストール後はホーム画面のアイコンから独立した画面で起動できます。
   iPhoneではSafariの共有メニュー →「ホーム画面に追加」。

注意:
- file://で直接開いただけではService Workerが動作せず、正規のPWAとしてインストールできない。
- データは端末のブラウザ/PWA内のlocalStorage（fishing-distance-log-v1）に保存。
  端末・ブラウザ・オリジンが変わると自動では引き継げません。CSVを定期的に書き出してください。
- manifest、Service Worker、アイコンはすべて相対パス。Service Workerの範囲はこのサブディレクトリのみ。
- 外部フォント・ライブラリ・APIへの依存はありません。記録はサーバーへ送信しません。
- SWを更新するときはsw.jsのCACHEバージョン（v2）を上げてください。
  同一オリジンの他ツールのキャッシュは削除しません。

検証（Node.js 18以上、追加パッケージ不要）:
リポジトリ直下で node --test cast-distance/tests/pwa.test.cjs

手動確認:
45回・89cm/回・100%で40.1mになること、保存→再読み込みで履歴が残ることを確認。
オンラインでオフライン準備完了を待ち、通信を切って公開URLとindex.htmlの両方で再起動。
Android/iPhoneで実際にホーム画面へ追加し、独立した画面で開くことを確認。
