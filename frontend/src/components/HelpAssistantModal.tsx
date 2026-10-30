import React, { useState, useRef, useEffect } from 'react';
import {
  BookOpen,
  MessageCircleQuestion,
  X,
  Send,
  Download,
  ExternalLink,
  Sparkles,
  FileText,
  ChevronRight,
  RotateCcw,
  HelpCircle,
} from 'lucide-react';

export type HelpModalTab = 'chat' | 'pdf';

interface KnowledgeItem {
  id: string;
  title: string;
  chapter: string;
  page: number;
  keywords: string[];
  summary: string;
  details: string[];
  mechanism?: string;
  relatedQuestions: string[];
}

const MANUAL_CHAPTERS = [
  { id: 'ch0', label: '概要・目次', page: 1, desc: '全体ワークフロー（Phase 1〜4）' },
  { id: 'ch1', label: '第1章：PDF読込・保存', page: 1, desc: 'アップロード・自動バックアップ・JSON共有' },
  { id: 'ch2', label: '第2章：領域・パーツ抽出', page: 2, desc: '図面枠/パーツ枠・透過・テンプレ置換' },
  { id: 'ch3', label: '第3章：ステージ配置', page: 4, desc: 'ベジェ曲線・打楽器・ピアノ蓋・縮尺測定' },
  { id: 'ch4', label: '第4章：自動集計・自動記入', page: 7, desc: '備品カウント・丸囲み・団体名等の枠検出' },
  { id: 'ch5', label: '第5章：プレビュー・出力', page: 8, desc: '文字/図形追記・強調表示・シーン間コピー' },
  { id: 'ch6', label: '第6章：ショートカット表', page: 9, desc: 'キーボード＆マウス操作早見表' },
];

const KNOWLEDGE_BASE: KnowledgeItem[] = [
  {
    id: 'workflow',
    title: '全体の使い方・4つのステップ（ワークフロー）',
    chapter: '概要・目次',
    page: 1,
    keywords: ['全体', '流れ', '使い方', '手順', 'ステップ', 'ワークフロー', '最初', 'やり方', '基本', 'とは', 'セッティングくん', 'stajet'],
    summary: '本アプリは「①PDF読込 → ②領域選択・パーツ抽出 → ③ステージ配置 → ④プレビュー・PDF出力」の4ステップで舞台配置図を作成します。',
    details: [
      '【Step 1：PDF読込】主催者指定の白紙PDFをドラッグ＆ドロップで読み込みます（過去の作業再開やJSON読込も可能）。',
      '【Step 2：領域選択・パーツ抽出】自動検出された「舞台図面枠（青枠）」と「パーツ抽出枠（緑枠）」を確認し、記号パーツの背景透過切り抜きとテンプレート置換を行います。',
      '【Step 3：ステージ配置】3次ベジェ曲線を使った椅子・譜面台の弧状配置、実寸打楽器の配置、ピアノ蓋状態の選択、複数曲（シーン）管理を行います。',
      '【Step 4：プレビュー・PDF出力】備品数の自動記入・選択肢の自動丸囲み・団体名や出演順のテキスト配置を確認・微調整し、提出用PDFをダウンロードします。',
    ],
    relatedQuestions: [
      '椅子や譜面台をカーブ（弧状）に並べるには？',
      '備品数や団体名が自動で入る仕組みは？',
      'データの保存や別PCへの引き継ぎ方法は？',
    ],
  },
  {
    id: 'backup_json',
    title: '自動保存（オートセーブ）とJSON書き出し・引き継ぎ',
    chapter: '第1章：プロジェクト管理',
    page: 1,
    keywords: ['保存', 'バックアップ', '自動保存', 'オートセーブ', 'json', 'エクスポート', 'インポート', '引き継ぎ', '別パソコン', '共有', '消えた', '復元', 'indexeddb', 'localstorage', '容量'],
    summary: '作業内容は操作のたびにブラウザ内（localStorage＋IndexedDB）へ自動保存されます。別端末への移動やメンバー共有には「JSON書き出し」を使用します。',
    details: [
      '【自動保存】操作停止後のアイドル時間およびページを閉じる瞬間に自動で保存され、ホーム画面の「最近のプロジェクト」からワンクリックで再開できます。',
      '【JSON書き出し（エクスポート）】ホーム画面のプロジェクト一覧、またはステージ配置画面右上の「JSON」ボタンから、全シーン・画像データ一式を含む .json ファイルを保存できます。',
      '【JSON読み込み（インポート）】ホーム画面の「JSONファイルからプロジェクトを復元」から .json を読み込むと、別のPCやタブレットでも完全に同じ状態で作業を再開できます。',
    ],
    mechanism: '軽量な座標・設定データは localStorage に即時保存し、数MBにおよぶ図面背景画像・抽出パーツ透過PNGは IndexedDB（settingkun_db）にスタンドアロンDataURLとして永続化する2層ハイブリッド構成を採用しています。',
    relatedQuestions: [
      '複数曲（シーン）を作るには？',
      'プロジェクト名を変更するには？',
    ],
  },
  {
    id: 'region_extract',
    title: '図面枠・パーツ枠の調整とパーツ自動抽出',
    chapter: '第2章：領域選択・パーツ抽出',
    page: 2,
    keywords: ['抽出', 'パーツ抽出', '失敗', '領域', '図面枠', 'パーツ枠', '青枠', '緑枠', '切り抜き', '透過', 'ラベル', 'パーツ枠調整', '図面枠調整', '再抽出'],
    summary: '青枠で「舞台図面エリア」、緑枠で「凡例（記号）エリア」を囲むことで、記号を自動で背景透過PNGとして切り抜き、周囲の文字から備品名を自動認識します。',
    details: [
      '【枠の調整】緑枠（パーツ抽出枠）は複数追加できます。記号が離れた場所にある場合は緑枠を追加して囲んでください。',
      '【後から調整する場合】ステージ配置画面の左メニュー「設定（歯車アイコン）」内にある「図面枠調整」「パーツ枠調整」からいつでも再調整できます。',
      '【パーツ枠調整モーダル】自動抽出で記号が欠けたり余計な線が入った場合は、「パーツ枠調整」を開き、赤枠をドラッグして範囲を直すか、何もない場所をドラッグして新しい枠を手動追加できます。ラベル名（椅子・譜面台等）もその場で書き換え可能です。',
    ],
    mechanism: 'PDF内部のベクター図形とOpenCV連結成分解析（connectedComponentsWithStats）を併用して小図形を検出し、輝度238以上の白背景をアルファ透過（make_white_transparent）します。さらに文字レベルトークナイザ（tokenize_pdf_region）が均等割り付け文字や縦書きを復元して記号周囲の名称を自動ラベリングします。',
    relatedQuestions: [
      'テンプレ置換とは何ですか？',
      '集計バーの数字と合わないときは？',
    ],
  },
  {
    id: 'template_replace',
    title: '高精細ベクターテンプレートへの置換機能',
    chapter: '第2章・第3章：テンプレート置換',
    page: 3,
    keywords: ['テンプレ', 'テンプレート', '置換', 'テンプレ置換', '綺麗', '粗い', 'ぼやける', 'ベクター', '元画像', '記号'],
    summary: 'PDFから切り抜いた画像が粗い場合、アプリ内蔵の美しいベクター図形（椅子・譜面台・ピアノ・指揮台など）にワンクリックで置換できます。',
    details: [
      '【自動マッチング】パーツ抽出直後のモーダル（または左メニュー「設定 ＞ テンプレ置換」）で、パーツ名から最適な内蔵テンプレートが自動提案されます。',
      '【個別切替】パーツごとに「テンプレートに置換」または「PDFの元画像を使用」を自由に切り替えられます。',
      '【集計との連動】テンプレートに置換しても、元のPDFパーツの備品カテゴリとして正しく集計されます。',
    ],
    relatedQuestions: [
      '椅子の丸マークを二重丸や四角に変えるには？',
      'カスタム記号（MやVoなど）を作るには？',
    ],
  },
  {
    id: 'bezier_curve',
    title: 'ベジェ曲線による椅子・譜面台の弧状（カーブ）配置',
    chapter: '第3章：3次ベジェ曲線システム',
    page: 5,
    keywords: ['曲線', 'ベジェ', 'ベジェ曲線', 'カーブ', '弧', '弧状', '扇形', '並べる', '列', '赤ハンドル', '青ハンドル', '制御点', 'ロック'],
    summary: '上部ツールバーの「曲線追加」から3次ベジェ曲線を配置し、その上に椅子・譜面台・セット記号を等間隔で美しく弧状に並べることができます。',
    details: [
      '【ハンドルの操作】白丸で左右の始点・終点を移動、中央の「赤ハンドル」でカーブの深さを調整、「青ハンドル」で左右の端点の広がり・高さを対称に調整できます。',
      '【自動スナップ】ハンドル操作中、ステージ中心軸（X=0）や水平線（Y=0）、直線・中点に近づくとピタッと吸着し、ガイドが緑色（#10b981）に光ります。',
      '【アイテムの追加】曲線を選択した状態で、右インスペクタの「曲線にアイテムを追加」から椅子・譜面台・椅子＋譜面台セット・PDFパーツをワンクリックで追加できます。',
      '【曲線のロック・補助線消去】右インスペクタから「曲線の移動ロック」や「制御点ハンドルの非表示」が可能で、プレビュー画面では曲線の補助線自体を非表示にして出力できます。',
    ],
    mechanism: '3次ベジェ曲線を微小線分に分割して累積弧長テーブルを構築する「等間隔弧長サンプリング（Arc-Length Parameterization）」により、曲率が変化してもアイテム間のピクセル距離が厳密に一定になるよう座標と接線角度を算出しています。',
    relatedQuestions: [
      '曲線上の特定の椅子の間だけ間隔を広げるには？',
      '曲線上のアイテムの順番を入れ替えるには？',
    ],
  },
  {
    id: 'curve_item_gap_order',
    title: '曲線上アイテムの個別間隔微調整・順序入替・スタイル変更',
    chapter: '第3章：曲線上のアイテム管理',
    page: 5,
    keywords: ['間隔', '個別間隔', '微調整', '余白', '通路', '順番', '並び順', '入れ替え', '左隣', '右隣', '椅子+譜面台', 'セット', 'サイズ'],
    summary: 'ベジェ曲線上の特定の1脚をクリックして選択すると、そのアイテムだけの間隔（余白）、並び順、サイズ、椅子の形状を個別に調整できます。',
    details: [
      '【個別間隔の微調整】曲線上のアイテムをクリックして選択し、右インスペクタの「右の間隔（個別間隔の微調整）」で数値入力、-5 / -1 / +1 / +5 ボタン、またはスライダーを動かすと、通路や楽器間のスペースを1px単位で空けられます。',
      '【並び順の入れ替え】右インスペクタの「← 左隣へ」「右隣へ →」ボタン、またはキーボードの「[」「]」キー（Alt + ← / →）で左右のアイテムと順番を入れ替えられます。',
      '【椅子・譜面台スタイルの変更】椅子を「○ / ◎ / ● / □」に切り替えたり、譜面台の表示スタイル（×マーク / 譜面台アイコン）や椅子との距離オフセットを調整できます。',
    ],
    relatedQuestions: [
      '椅子や譜面台をカーブ（弧状）に並べるには？',
      'キーボードショートカット一覧を教えて',
    ],
  },
  {
    id: 'piano_lid',
    title: 'ピアノの配置と「蓋（ふた）の状態」選択機能',
    chapter: '第3章：グランドピアノと蓋の状態',
    page: 4,
    keywords: ['ピアノ', 'グランドピアノ', '蓋', 'ふた', 'フタ', '全開', '半開', '半半開', '閉', '蒲鉾', 'カマボコ', 'ポップアップ', 'ピアノ椅子', '譜めくり'],
    summary: 'ピアノをステージに配置すると、PDFに記載されている「蓋の状態」の選択肢がポップアップ表示され、選んだ状態がプレビューの記入欄にも自動反映されます。',
    details: [
      '【配置時ポップアップ】PDF内に「全開・半開・半半開・閉」「蒲鉾板」などの記載がある場合、それを自動引用してポップアップで質問します（記載がないPDFではポップアップは出ません）。',
      '【後から変更する方法】配置済みのピアノをクリックして選択すると、右メニュー（インスペクタ）の「ピアノの蓋の状態」からいつでも状態を変更できます。',
      '【プレビューへの自動反映】選択した蓋の状態（半開など）は、プレビュー画面に進んだ際、PDF上の該当する文字に自動で丸（○）が付けられます。',
    ],
    relatedQuestions: [
      'ピアノ椅子の記号（◎やhマーク）を変えるには？',
      '備品数や団体名が自動で入る仕組みは？',
    ],
  },
  {
    id: 'percussion_label',
    title: '打楽器ライブラリ（19種）と文字の縦書き・位置・サイズ調整',
    chapter: '第3章：打楽器＆ラベル詳細設定',
    page: 4,
    keywords: ['打楽器', 'パーカッション', 'ティンパニ', 'ドラム', 'マリンバ', 'ビブラフォン', 'シロフォン', 'グロッケン', 'チャイム', 'シンバル', 'バスドラ', '銅鑼', 'ドラ', '縦書き', '横書き', '文字位置', '字間', '引き出し線', 'スペースキー'],
    summary: '全19種の実寸打楽器を収録しており、Spaceキー長押しで素早く連続配置できます。楽器名の文字は縦書き・回転・図形外への引き出し配置が可能です。',
    details: [
      '【高速追加モード】ステージ配置画面で Space キーを押している間（または打楽器ピン留め時）、上部に4カテゴリ（太鼓・ティンパニ／鍵盤打楽器／シンバル・金属／その他）のパレットが開きます。',
      '【文字の縦書き・位置調整】打楽器を選択して右メニューの「名称・位置・縦書き設定」（またはダブルクリック）を開くと、モーダル内のプレビュー上で文字を直接ドラッグして好きな位置へ移動できます（枠外に出すと自動で引き出し線が付きます）。',
      '【詳細スタイル】表示名の書き換え（Timp. → ティンパニ 等）、文字の非表示化、縦書き/横書き切替、文字サイズ、文字角度、字間スペース（-4px〜+24px）を自由に調整できます。',
    ],
    relatedQuestions: [
      '図面の縮尺（メートル）を合わせるには？',
      'カスタム記号（MやVoなど）を作るには？',
    ],
  },
  {
    id: 'scale_center',
    title: '縮尺（スケール）測定とステージ中心マーカー設定',
    chapter: '第3章：縮尺測定・中心マーカー',
    page: 6,
    keywords: ['縮尺', 'スケール', '測定', 'メートル', '実寸', '大きさ', 'サイズ感', '中心', 'センター', '中心マーカー', '基準点', 'グリッド', 'スナップ'],
    summary: '図面上の寸法線（例：12.6m）の2点をクリックしてメートル数を入力するだけで、図面の縮尺に合わせて打楽器等の実寸サイズが自動校正されます。',
    details: [
      '【縮尺測定の手順】左メニュー「設定 ＞ 縮尺測定」を押し、図面上の長さが分かっている場所の始点と終点の2箇所をクリックしてメートル数（例：12.6）を入力します。',
      '【中心マーカーの設定】左メニュー「設定 ＞ 中心マーカー表示」をONにすると赤い十字ターゲットが表示されます。「中心位置を移動」で舞台中央（指揮台の位置など）に合わせると、曲線の中心スナップ基準点になります。',
    ],
    relatedQuestions: [
      '打楽器の文字を縦書きや外側に移動するには？',
      'フローティング十字キー（リモコン）とは？',
    ],
  },
  {
    id: 'floating_dpad',
    title: 'フローティング十字キー／トラックパッド＆整列ツール',
    chapter: '第3章：フローティング操作・整列',
    page: 6,
    keywords: ['十字キー', 'トラックパッド', 'フローティング', 'リモコン', '微移動', 'タブレット', 'ipad', 'スマホ', '整列', '均等配置', 'ピン留め', 'ロック'],
    summary: '画面上に浮かぶリモコン（十字キー／トラックパッド）で1px単位の微調整やタブレット操作が快適に行えます。複数選択時の8種整列ツールも搭載しています。',
    details: [
      '【フローティングパネル】上部ツールバーの十字キーアイコンで表示/非表示を切り替えられます。「十字キーモード」と「トラックパッドモード」があり、曲線選択時は赤・青ハンドルのリモート操作パッドも出現します。',
      '【8種の整列・均等配置】Shift＋クリックまたはドラッグ範囲選択で複数オブジェクトを選ぶと、上部ツールバーから「左揃え・左右中央・右揃え・上揃え・上下中央・下揃え」および「水平/垂直均等配置（3個以上）」が実行できます。',
      '【ピン留め固定】動かしたくないオブジェクトは Ctrl/Cmd + F（またはインスペクタのピン留めボタン）でロックできます。',
    ],
    relatedQuestions: [
      'キーボードショートカット一覧を教えて',
    ],
  },
  {
    id: 'auto_tally_fields',
    title: '備品数の自動集計・丸囲み・団体名や出演順の自動配置の仕組み',
    chapter: '第4章：自動集計＆紙面マッピング',
    page: 7,
    keywords: ['集計', '自動集計', 'カウント', '数', '脚', '本', '要', '不要', '使う', '使わない', '丸囲み', '出演順', '番号', '団体名', '学校名', '指揮者', '部門', 'ふりがな', 'テキストボックス', '係記入', 'ひな壇'],
    summary: 'ステージ上の備品数を自動集計し、プレビュー遷移時にPDF上の「要・不要の丸囲み」「数量欄への数字記入」「団体名・出演順・指揮者名等の入力枠」を自動生成します。',
    details: [
      '【備品数の集計と手動調整】下部バーに単体＋曲線上の全備品数がリアルタイム表示されます（椅子＋譜面台セットは両方に+1加算）。予備分などは「＋」「ー」ボタンで手動調整可能です。',
      '【自動丸囲み＆数字記入】PDF内の「使う・使わない」「要・不要」「借用する・しない」を検出し、使用数＞0なら肯定側、＝0なら否定側に自動で丸を付け、「（　）脚」「（　）本」やひな壇の段別表に数字を自動配置します。',
      '【団体名・出演順・指揮者等の自動枠検出】表セルの罫線矩形、括弧囲み（【 】、（ ））、先行空欄（［ ］部門、＿＿の部）、縦書き見出し（出・演・順、団・体・名）を解析し、各入力枠の中心にテキストボックスを自動配置します。',
      '【係記入欄の自動除外】「※係りで記入します」「受付記入欄」「記入しないで」等の注記がある欄は自動でスキップされます。',
    ],
    relatedQuestions: [
      'プレビュー画面で文字や丸囲みを追加・修正するには？',
      'プレビューの青い強調枠は出力される？',
    ],
  },
  {
    id: 'preview_export',
    title: '最終プレビューでの直接編集・強調表示・複数曲コピー・PDF出力',
    chapter: '第5章：プレビュー・PDF出力',
    page: 8,
    keywords: ['プレビュー', '出力', 'pdf出力', 'ダウンロード', '印刷', '強調', 'ハイライト', '青い枠', '水色', '消える', 'テキスト追加', '図形', '矢印', '丸', 'シーン', '複数曲', 'コピー', '補助線'],
    summary: 'プレビュー画面では紙面上のどこにでも文字や図形（丸・矢印等）を追加・移動でき、強調表示で記入漏れを確認した上でクリーンな提出用PDFを出力できます。',
    details: [
      '【文字・図形の自由編集】自動配置された「団体名を入力」「番号」等をダブルクリックして書き換えられるほか、上部ツールバーや右クリックからテキスト・図形（丸○、二重丸◎、四角□、三角△、バツ×、直線、矢印→）を自由に追加できます。',
      '【強調表示は出力時に自動消去】プレビュー上で入力箇所を分かりやすくする水色の強調表示（ハイライト）や赤枠は、PDF出力ボタンを押した瞬間に自動的に100%非表示化されてから出力されるため、提出PDFには一切残りません。',
      '【複数曲（シーン）と一括コピー】複数シーンを作った場合、「他シーンへコピー」ボタンから1曲目で入力した団体名や指揮者名を全シーンへ一括コピーでき、PDF出力時は全曲が複数ページの1つのPDFにまとまって出力されます。',
    ],
    relatedQuestions: [
      '全体の流れを教えて',
      'データの保存や別PCへの引き継ぎ方法は？',
    ],
  },
  {
    id: 'shortcuts',
    title: 'キーボードショートカット＆操作早見表',
    chapter: '第6章：ショートカット早見表',
    page: 9,
    keywords: ['ショートカット', 'キーボード', 'キー', 'undo', 'redo', '元に戻す', 'やり直す', 'コピー', 'ペースト', '削除', 'delete', 'space', '矢印', 'ズーム', '拡大', '縮小', '右クリック'],
    summary: '主要なキーボードショートカットとマウス操作の一覧です。',
    details: [
      '・Ctrl / Cmd + Z ：元に戻す（Undo）',
      '・Ctrl / Cmd + Shift + Z（または Ctrl + Y）：やり直す（Redo）',
      '・Ctrl / Cmd + C / V ：選択オブジェクトのコピー ／ ペースト',
      '・Ctrl / Cmd + A ：ステージ上の全オブジェクトを選択',
      '・Ctrl / Cmd + F ：選択オブジェクトのピン留め（移動ロック）切替',
      '・Delete / Backspace ：選択中のアイテム・曲線・文字・図形を削除',
      '・矢印キー（↑↓←→）：1px単位で微移動（Shift併用で高速移動）',
      '・「[」または Alt + ← ／ 「]」または Alt + → ：曲線上の選択アイテムを左隣／右隣へ順番移動',
      '・Spaceキー長押し ：打楽器パレットを展開（連続追加モード）',
      '・Ctrl + マウスホイール（またはピンチ）：カーソル位置を中心に拡大・縮小',
    ],
    relatedQuestions: [
      'フローティング十字キー（リモコン）とは？',
      '曲線上の特定の椅子の間だけ間隔を広げるには？',
    ],
  },
];

const SYNONYM_MAP: Array<[RegExp, string]> = [
  [/イス|いす/g, '椅子'],
  [/フタ|ふた/g, '蓋'],
  [/カーブ|弧|扇|列/g, '曲線 ベジェ'],
  [/保存|セーブ|引き継ぎ|共有|移行|別pc|別パソコン/gi, 'バックアップ json IndexedDB'],
  [/文字|名前|テキスト|ラベル|書きたい|入力/g, '打楽器ラベル テキスト追加 団体名'],
  [/印刷|書き出し|ダウンロード|保存したい/g, 'pdf出力 プレビュー'],
  [/青い枠|水色|赤枠|枠がそのまま/g, '強調 ハイライト プレビュー 出力'],
  [/サイズ|大きさ|メートル|m|距離/g, '縮尺 スケール 測定'],
  [/曲|2曲|課題曲|自由曲|場面/g, 'シーン 複数曲 コピー'],
  [/自動|入らない|ずれる|枠/g, '出演順 団体名 自動集計 パーツ抽出'],
];

function findBestAnswer(query: string): {
  answer: string;
  matchedItems: KnowledgeItem[];
  suggestedQuestions: string[];
} {
  const cleanQ = query.trim();
  let expandedQ = cleanQ.toLowerCase();
  for (const [pattern, replacement] of SYNONYM_MAP) {
    if (pattern.test(cleanQ)) {
      expandedQ += ' ' + replacement.toLowerCase();
    }
  }

  // Score each knowledge item
  const scored = KNOWLEDGE_BASE.map((item) => {
    let score = 0;
    for (const kw of item.keywords) {
      const lkw = kw.toLowerCase();
      if (expandedQ.includes(lkw)) {
        score += lkw.length >= 3 ? 12 : 7;
      }
    }
    if (expandedQ.includes(item.title.toLowerCase())) {
      score += 20;
    }
    // Character bigram overlap across summary & details
    const fullText = (item.title + ' ' + item.summary + ' ' + item.details.join(' ') + ' ' + (item.mechanism || '')).toLowerCase();
    for (let i = 0; i < cleanQ.length - 1; i++) {
      const bg = cleanQ.slice(i, i + 2).toLowerCase();
      if (!bg.trim()) continue;
      if (fullText.includes(bg)) {
        score += 1.5;
      }
    }
    return { item, score };
  }).sort((a, b) => b.score - a.score);

  const top = scored.filter((s) => s.score >= 5).slice(0, 2);
  if (top.length === 0) {
    const fallback = KNOWLEDGE_BASE[0];
    return {
      answer: `ご質問ありがとうございます。「${cleanQ}」に関連する案内です。\n\n${fallback.summary}\n\n${fallback.details.join('\n')}\n\nより具体的なキーワード（例：「曲線の引き方」「ピアノの蓋」「打楽器の縦書き」「縮尺の合わせ方」「JSON保存」「出演順の自動入力」など）でもお気軽にご質問ください！`,
      matchedItems: [fallback],
      suggestedQuestions: fallback.relatedQuestions,
    };
  }

  const primary = top[0].item;
  const asksMechanism = /仕組み|アルゴリズム|どうやって|なぜ|内部|原理|技術|自動/.test(cleanQ);

  let lines: string[] = [];
  lines.push(`**【${primary.title}】**（説明書 ${primary.chapter} / P.${primary.page}）`);
  lines.push(primary.summary);
  lines.push('');
  for (const d of primary.details) {
    lines.push(d);
  }
  if (primary.mechanism && (asksMechanism || top[0].score >= 15)) {
    lines.push('');
    lines.push(`💡 **内部の仕組み**：${primary.mechanism}`);
  }

  if (top.length > 1 && top[1].score >= top[0].score * 0.65) {
    const secondary = top[1].item;
    lines.push('');
    lines.push(`---`);
    lines.push(`**【関連：${secondary.title}】**（P.${secondary.page}）`);
    lines.push(secondary.summary);
    if (secondary.details[0]) {
      lines.push(secondary.details[0]);
    }
  }

  const matchedItems = top.map((t) => t.item);
  const suggested = Array.from(
    new Set(matchedItems.flatMap((m) => m.relatedQuestions))
  ).slice(0, 3);

  return {
    answer: lines.join('\n'),
    matchedItems,
    suggestedQuestions: suggested,
  };
}

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  matchedItems?: KnowledgeItem[];
  suggestedQuestions?: string[];
}

const INITIAL_SUGGESTIONS = [
  '全体の使い方の流れを教えて',
  '椅子や譜面台をカーブ（弧状）に並べるには？',
  'ピアノの蓋の状態を変えるには？',
  '打楽器の文字を縦書きや外側に移動するには？',
  '出演順や団体名・備品数が自動で入る仕組みは？',
  'プレビューの青い強調枠は出力される？',
];

function renderFormattedText(text: string) {
  return text.split('\n').map((line, lineIdx) => {
    const parts = line.split(/(\*\*.*?\*\*)/g);
    return (
      <React.Fragment key={lineIdx}>
        {parts.map((part, i) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong key={i} className="font-bold text-slate-900 dark:text-white">
                {part.slice(2, -2)}
              </strong>
            );
          }
          return part;
        })}
        {lineIdx < text.split('\n').length - 1 && '\n'}
      </React.Fragment>
    );
  });
}

export const HelpAssistantModal: React.FC<{
  isOpen: boolean;
  initialTab?: HelpModalTab;
  onClose: () => void;
}> = ({ isOpen, initialTab = 'chat', onClose }) => {
  const [activeTab, setActiveTab] = useState<HelpModalTab>(initialTab);
  const [pdfPage, setPdfPage] = useState<number>(1);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'こんにちは！「セッティングくん」公式説明書AIアシスタントです。\nステージ配置、ベジェ曲線、パーツ抽出、ピアノの蓋設定、打楽器ラベル調整、自動集計の仕組みなど、知りたいことを何でも質問してください！',
      suggestedQuestions: INITIAL_SUGGESTIONS,
    },
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTab]);

  if (!isOpen) return null;

  const handleSendQuestion = (qText?: string) => {
    const q = (qText ?? input).trim();
    if (!q) return;
    if (!qText) setInput('');

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      text: q,
    };

    const result = findBestAnswer(q);
    const botMsg: ChatMessage = {
      id: `bot_${Date.now() + 1}`,
      role: 'assistant',
      text: result.answer,
      matchedItems: result.matchedItems,
      suggestedQuestions: result.suggestedQuestions,
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
  };

  const openPdfAtPage = (page: number) => {
    setPdfPage(page);
    setActiveTab('pdf');
  };

  const handleResetChat = () => {
    setMessages([
      {
        id: 'welcome_' + Date.now(),
        role: 'assistant',
        text: 'チャット履歴をリセットしました。知りたい機能や操作について質問してください！',
        suggestedQuestions: INITIAL_SUGGESTIONS,
      },
    ]);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl h-[86vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/90 dark:border-slate-700 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/90 dark:bg-slate-800/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-sm">
              {activeTab === 'chat' ? (
                <Sparkles className="w-4 h-4" />
              ) : (
                <BookOpen className="w-4 h-4" />
              )}
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-tight">
                公式取扱説明書 ＆ AI質問サポート
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                全機能・操作方法・自動解析の仕組みを網羅したガイドとQ&Aチャットボット
              </p>
            </div>
          </div>

          {/* Center Tab Switcher */}
          <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-700/80 p-1 rounded-full text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-bold transition-all cursor-pointer ${
                activeTab === 'chat'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <MessageCircleQuestion className="w-3.5 h-3.5" />
              <span>AI質問チャット</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pdf')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-bold transition-all cursor-pointer ${
                activeTab === 'pdf'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>説明書PDF (全10頁)</span>
            </button>
          </div>

          {/* Right PDF External / Close Actions */}
          <div className="flex items-center gap-2">
            <a
              href="/manual.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 transition-colors"
              title="説明書PDFを新しいタブで開く"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
              <span>別タブでPDFを開く</span>
            </a>
            <a
              href="/manual.pdf"
              download="セッティングくん_取扱説明書.pdf"
              className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-sky-300 hover:bg-blue-100 transition-colors"
              title="説明書PDFをダウンロード"
            >
              <Download className="w-3.5 h-3.5" />
              <span>PDF保存</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              title="閉じる"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        {activeTab === 'chat' ? (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Left Sidebar: Manual Chapters & Topics */}
            <div className="hidden md:flex w-64 border-r border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex-col p-3.5 overflow-y-auto shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  説明書 目次ジャンプ
                </span>
              </div>
              <div className="space-y-1 mb-4">
                {MANUAL_CHAPTERS.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => openPdfAtPage(ch.page)}
                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-blue-50 dark:hover:bg-slate-800 group transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-blue-600">
                        {ch.label}
                      </span>
                      <span className="text-[10px] font-mono text-blue-600 dark:text-sky-400 bg-blue-100/70 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                        P.{ch.page}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      {ch.desc}
                    </p>
                  </button>
                ))}
              </div>

              <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-auto">
                <button
                  type="button"
                  onClick={handleResetChat}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>会話をリセット</span>
                </button>
              </div>
            </div>

            {/* Right Main Chat Area */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-900">
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 select-text">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-xs shadow-xs font-medium'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-xs border border-slate-200/80 dark:border-slate-700'
                      }`}
                    >
                      {renderFormattedText(msg.text)}

                      {/* Jump to PDF Page buttons if matchedItems exist */}
                      {msg.matchedItems && msg.matchedItems.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-slate-200/80 dark:border-slate-700 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">
                            📖 該当ページを開く:
                          </span>
                          {msg.matchedItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => openPdfAtPage(item.page)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
                            >
                              <BookOpen className="w-3 h-3" />
                              <span>
                                {item.chapter} (P.{item.page}) をPDFで見る
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Suggested follow-up chips */}
                    {msg.role === 'assistant' &&
                      msg.suggestedQuestions &&
                      msg.suggestedQuestions.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5 max-w-[90%]">
                          {msg.suggestedQuestions.map((sq, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => handleSendQuestion(sq)}
                              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium bg-blue-50 dark:bg-slate-800 text-blue-700 dark:text-sky-300 border border-blue-200 dark:border-slate-700 hover:bg-blue-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                            >
                              <span>{sq}</span>
                              <ChevronRight className="w-3 h-3 opacity-70" />
                            </button>
                          ))}
                        </div>
                      )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Bottom Chat Input Bar */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendQuestion();
                }}
                className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 flex items-center gap-2 shrink-0"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="使い方の疑問や知りたい機能を入力してください（例：ピアノの蓋、曲線の間隔、打楽器の縦書き、縮尺測定...）"
                  className="flex-1 px-4 py-2.5 rounded-full text-xs sm:text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className={`px-4 py-2.5 rounded-full text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 transition-all cursor-pointer ${
                    input.trim()
                      ? 'bg-blue-600 hover:bg-blue-700 shadow-xs'
                      : 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>質問する</span>
                </button>
              </form>
            </div>
          </div>
        ) : (
          /* PDF Viewer Tab */
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Chapter quick jump bar on the left */}
            <div className="w-full md:w-60 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-2.5 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto shrink-0">
              <div className="hidden md:block text-[11px] font-bold text-slate-500 dark:text-slate-400 px-2 py-1">
                章を選択してページ移動
              </div>
              {MANUAL_CHAPTERS.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setPdfPage(ch.page)}
                  className={`px-2.5 py-2 rounded-xl text-left shrink-0 transition-colors cursor-pointer ${
                    pdfPage === ch.page
                      ? 'bg-blue-600 text-white font-bold'
                      : 'hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span>{ch.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        pdfPage === ch.page
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      P.{ch.page}
                    </span>
                  </div>
                  <p
                    className={`hidden md:block text-[10px] mt-0.5 truncate ${
                      pdfPage === ch.page
                        ? 'text-blue-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {ch.desc}
                  </p>
                </button>
              ))}
            </div>

            {/* Embedded PDF iframe */}
            <div className="flex-1 bg-slate-200 dark:bg-slate-950 relative">
              <iframe
                key={`pdf_page_${pdfPage}`}
                src={`/manual.pdf#page=${pdfPage}`}
                title="セッティングくん 公式取扱説明書 PDF"
                className="w-full h-full border-0"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const HelpHeaderButtons: React.FC<{
  compact?: boolean;
}> = ({ compact = false }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<HelpModalTab>('chat');

  const openPdf = () => {
    setModalTab('pdf');
    setModalOpen(true);
  };

  const openChat = () => {
    setModalTab('chat');
    setModalOpen(true);
  };

  return (
    <>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={openPdf}
          className="h-8 px-2.5 sm:px-3 rounded-full text-xs font-bold liquid-btn text-slate-700 dark:text-slate-100 hover:text-blue-600 dark:hover:text-sky-400 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
          title="公式取扱説明書・全機能仕様書PDFを閲覧・ダウンロードします"
        >
          <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400 shrink-0" />
          <span className={compact ? 'hidden xl:inline' : 'hidden sm:inline'}>
            説明書PDF
          </span>
        </button>
        <button
          type="button"
          onClick={openChat}
          className="h-8 px-2.5 sm:px-3 rounded-full text-xs font-bold liquid-btn text-slate-700 dark:text-slate-100 hover:text-blue-600 dark:hover:text-sky-400 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
          title="説明書の内容について質問できるAIヘルプチャットボットを開きます"
        >
          <HelpCircle className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <span className={compact ? 'hidden xl:inline' : 'hidden sm:inline'}>
            質問チャット
          </span>
        </button>
      </div>

      <HelpAssistantModal
        isOpen={modalOpen}
        initialTab={modalTab}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
};
