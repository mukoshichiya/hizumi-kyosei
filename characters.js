/*
 * このファイルを編集すると、一覧と個別紹介ページの両方に自動反映されます。
 * キャラ画像は assets/ のSVGを、手持ちの PNG / JPG / WEBP に差し替えてください。
 */
const SITE_SETTINGS = {
  siteName: "歪矯正", // サイト左上に表示する名前
  headline: "CHARACTERS",
  subtitle: "キャラクター一覧",
  introduction: "ここは、あなたの創作世界に登場するキャラクターたちのアーカイブです。気になる人物を選んで、プロフィールやギャラリーをご覧ください。",
};

// 以下は見本用の6人です。名前以外の紹介文・画像は仮置きです。
const CHARACTERS = [
  {
    id: "jofu-saiichi", // 英数字とハイフンだけ。URLに使われます
    number: "001",
    name: "上府 才一",
    reading: "じょうふ さいいち",
    category: "ORIGINAL CHARACTER",
    catchphrase: "プロフィールの見出しをここに入力",
    description: "ここにキャラクターの性格や能力、作中での立ち位置などの紹介文を書きます。改行もそのまま表示されます。",
    profile: [
      { label: "所属", value: "ここに入力" },
      { label: "能力", value: "ここに入力" },
      { label: "備考", value: "ここに入力" },
    ],
    images: [
      { src: "assets/jofu-saiichi-1.svg", title: "MAIN VISUAL", caption: "メインビジュアル" },
      { src: "assets/jofu-saiichi-2.svg", title: "GALLERY 01", caption: "表情・ポーズなど" },
      { src: "assets/jofu-saiichi-3.svg", title: "GALLERY 02", caption: "設定画・別衣装など" },
    ],
  },
  {
    id: "utago-soyoka",
    number: "002",
    name: "重多力 微香",
    reading: "うたご そよか",
    category: "ORIGINAL CHARACTER",
    catchphrase: "プロフィールの見出しをここに入力",
    description: "ここにキャラクターの紹介文を入力します。\nエピソードや印象的なセリフなども書けます。",
    profile: [
      { label: "所属", value: "ここに入力" },
      { label: "能力", value: "ここに入力" },
      { label: "備考", value: "ここに入力" },
    ],
    images: [
      { src: "assets/utago-soyoka-1.svg", title: "MAIN VISUAL", caption: "メインビジュアル" },
      { src: "assets/utago-soyoka-2.svg", title: "GALLERY 01", caption: "表情・ポーズなど" },
      { src: "assets/utago-soyoka-3.svg", title: "GALLERY 02", caption: "設定画・別衣装など" },
    ],
  },
  {
    id: "rikujika",
    number: "003",
    name: "リクジカ",
    reading: "りくじか",
    category: "ORIGINAL CHARACTER",
    catchphrase: "プロフィールの見出しをここに入力",
    description: "ここにキャラクターの紹介文を入力します。",
    profile: [
      { label: "所属", value: "ここに入力" },
      { label: "能力", value: "ここに入力" },
      { label: "備考", value: "ここに入力" },
    ],
    images: [
      { src: "assets/rikujika-1.svg", title: "MAIN VISUAL", caption: "メインビジュアル" },
      { src: "assets/rikujika-2.svg", title: "GALLERY 01", caption: "表情・ポーズなど" },
      { src: "assets/rikujika-3.svg", title: "GALLERY 02", caption: "設定画・別衣装など" },
    ],
  },
  {
    id: "rerira",
    number: "004",
    name: "レリラ",
    reading: "れりら",
    category: "ORIGINAL CHARACTER",
    catchphrase: "プロフィールの見出しをここに入力",
    description: "ここにキャラクターの紹介文を入力します。",
    profile: [
      { label: "所属", value: "ここに入力" },
      { label: "能力", value: "ここに入力" },
      { label: "備考", value: "ここに入力" },
    ],
    images: [
      { src: "assets/rerira-1.svg", title: "MAIN VISUAL", caption: "メインビジュアル" },
      { src: "assets/rerira-2.svg", title: "GALLERY 01", caption: "表情・ポーズなど" },
      { src: "assets/rerira-3.svg", title: "GALLERY 02", caption: "設定画・別衣装など" },
    ],
  },
  {
    id: "okonai-matsuro",
    number: "005",
    name: "興内 焉了",
    reading: "おこない まつろ",
    category: "ORIGINAL CHARACTER",
    catchphrase: "プロフィールの見出しをここに入力",
    description: "ここにキャラクターの紹介文を入力します。",
    profile: [
      { label: "所属", value: "ここに入力" },
      { label: "能力", value: "ここに入力" },
      { label: "備考", value: "ここに入力" },
    ],
    images: [
      { src: "assets/okonai-matsuro-1.svg", title: "MAIN VISUAL", caption: "メインビジュアル" },
      { src: "assets/okonai-matsuro-2.svg", title: "GALLERY 01", caption: "表情・ポーズなど" },
      { src: "assets/okonai-matsuro-3.svg", title: "GALLERY 02", caption: "設定画・別衣装など" },
    ],
  },
  {
    id: "hassuiba-isoku",
    number: "006",
    name: "撥水場 異速",
    reading: "",
    category: "ORIGINAL CHARACTER",
    catchphrase: "プロフィールの見出しをここに入力",
    description: "ここにキャラクターの紹介文を入力します。",
    profile: [
      { label: "所属", value: "ここに入力" },
      { label: "能力", value: "ここに入力" },
      { label: "備考", value: "ここに入力" },
    ],
    images: [
      { src: "assets/hassuiba-isoku-1.svg", title: "MAIN VISUAL", caption: "メインビジュアル" },
      { src: "assets/hassuiba-isoku-2.svg", title: "GALLERY 01", caption: "表情・ポーズなど" },
      { src: "assets/hassuiba-isoku-3.svg", title: "GALLERY 02", caption: "設定画・別衣装など" },
    ],
  },
];
