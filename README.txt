【オリジナルキャラクター紹介サイト 初期版】

■ 最初の開き方（WindowsでもOK）
1. ZIPを展開します。
2. 中にある index.html をダブルクリックします。
3. ブラウザーでキャラクター一覧が開きます。
   インターネット接続や専用アプリは不要です。

■ 今できること
・キャラクターを画像と名前付きで一覧表示
・名前・読み仮名で検索
・キャラをクリックして専用プロフィールへ移動
・メイン画像の拡大表示
・追加ギャラリー画像の切り替え
・拡大表示で左右の矢印キー、Escapeキーに対応
・スマホ向けのレイアウト
・URL末尾 #/character/xxxx を使った個別ページ共有（Web公開後）

■ サイト名を変える
characters.js の最初にある
  siteName: "YOUR WORLD"
の部分を好きなサイト名に変更してください。

■ キャラの説明を編集する
characters.js に入っている CHARACTERS のデータを編集します。
各キャラの name / reading / catchphrase / description / profile が表示内容です。
上の一覧も紹介ページも自動更新されます。

■ 自分の絵を使う（重要）
今入っている assets/*.svg はすべて仮画像です。
絵を置く例：
  assets/saiichi_main.png
  assets/saiichi_face.png
  assets/saiichi_outfit.png
characters.js の対象キャラの images を次のように変更します。
  images: [
    { src: "assets/saiichi_main.png", title: "MAIN VISUAL", caption: "メインビジュアル" },
    { src: "assets/saiichi_face.png", title: "EXPRESSION", caption: "表情差分" },
    { src: "assets/saiichi_outfit.png", title: "COSTUME", caption: "別衣装" },
  ],
PNG / JPG / WEBP 形式などが使えます。追加画像は何枚でも増やせます。
※画像ファイルは勝手に読み込まれません。images の src にファイル名を指定してください。
※一覧のサムネイルには images の一番最初の画像が使われます。

■ キャラを追加する
characters.js の CHARACTERS 配列に、他のキャラと同じ形式のデータを追加します。
・id は既存のキャラと被らない英数字とハイフン
・number は好きな番号
・name に名前
・images に画像ファイルのパス
を設定すれば一覧とプロフィールに反映されます。

■ デザインを変える
色、余白、文字サイズなどは style.css を変更します。
冒頭の :root にある --accent が差し色です。

■ ファイルの役割
index.html    サイトの土台
style.css     デザイン
characters.js キャラのデータ（主にここを編集）
app.js        一覧・画面遷移・ギャラリーの動作
assets/       仮の画像18枚（自分のイラストと差し替え）

■ 公開する
ローカルで動作確認したあと、GitHub Pages等の静的サイト公開サービスに
これらのファイルをアップロードするとURLで公開できます。
（初期版はログインや非公開アクセス制限を実装していません。
 公開すると誰でも閲覧できる前提なので、非公開資料の掲載には注意してください。）

■ 制作メモ
フレームワークや課金サービスは使用していません。
この初期版を元に、作品別タブ、タグ、相関図、世界観ページ、年表などを後から拡張できます。
