// All Lookism characters with their base stats
// dateAdded: used for "Newest" / "Oldest" sorting - includes time for unique ordering
// Strongest characters = oldest (added first), Weakest = newest (added last)
export const CHARACTERS = [
  { name: "James Lee", ticker: "DG", basePrice: 85, dateAdded: "2026-01-13T00:00:00", altNames: ["Diego Kang"] },
  {
    name: "Mujin Jin",
    ticker: "JIN",
    basePrice: 85,
    dateAdded: "2026-01-13T00:00:30",
    trailingFactors: [
      { ticker: "GAP", coefficient: 0.4 },
      { ticker: "SHNG", coefficient: 0.4 },
      { ticker: "VIN", coefficient: 0.3 }
    ]
  },
  {
    name: "Shingen Yamazaki",
    ticker: "SHNG",
    basePrice: 85,
    dateAdded: "2026-01-13T00:01:00",
    trailingFactors: [
      { ticker: "GAP", coefficient: 0.4 },
      { ticker: "JIN", coefficient: 0.4 }
    ]
  },
  {
    name: "Gapryong Kim",
    ticker: "GAP",
    basePrice: 85,
    dateAdded: "2026-01-13T00:02:00",
    trailingFactors: [
      { ticker: "SHNG", coefficient: 0.4 },
      { ticker: "JIN", coefficient: 0.4 },
      { ticker: "KTAE", coefficient: 0.2 },
      { ticker: "JAKE", coefficient: 0.2 }
    ]
  },
  { name: "Gun Park", ticker: "GUN", basePrice: 85, dateAdded: "2026-01-13T00:03:00" },
  { name: "Goo Kim", ticker: "GOO", basePrice: 85, dateAdded: "2026-01-13T00:04:00" },
  {
    name: "Daniel Park (Big)",
    ticker: "BDNL",
    basePrice: 85,
    dateAdded: "2026-01-13T00:05:00",
    altNames: ["Big Daniel"],
    trailingFactors: [
      { ticker: "LDNL", coefficient: 0.3 }
    ]
  },
  { name: "Sophia Alexander", ticker: "SOPH", basePrice: 80, dateAdded: "2026-01-13T00:06:00" },
  { name: "Kitae Kim", ticker: "KTAE", basePrice: 80, dateAdded: "2026-01-13T00:07:00", altNames: ["Gitae Kim"] },
  { name: "Johan Seong", ticker: "GDOG", basePrice: 80, dateAdded: "2026-01-13T00:08:00", altNames: ["Yohan Seong"] },
  { name: "Tom Lee", ticker: "TOM", basePrice: 78, dateAdded: "2026-01-13T00:09:00" },
  { name: "Shintaro Yamazaki", ticker: "SHRO", basePrice: 75, dateAdded: "2026-01-13T00:10:00" },
  { name: "Changsu Oh", ticker: "CROW", basePrice: 75, dateAdded: "2026-01-13T00:11:00" },
  { name: "Manager Kim", ticker: "SRMK", basePrice: 74, dateAdded: "2026-01-13T00:12:00" },
  { name: "Charles Choi", ticker: "ELIT", basePrice: 72, dateAdded: "2026-01-13T00:13:00", altNames: ["Elite"] },
  { name: "Jinyeong Park", ticker: "JYNG", basePrice: 72, dateAdded: "2026-01-13T00:14:00" },
  {
    name: "Daniel Park (Small)",
    ticker: "LDNL",
    basePrice: 70,
    dateAdded: "2026-01-13T00:15:00",
    altNames: ["Little Daniel"],
    trailingFactors: [
      { ticker: "BDNL", coefficient: 0.3 }
    ]
  },
  { name: "Paecheon Jo", ticker: "CROC", basePrice: 66, dateAdded: "2026-01-13T00:16:00" },
  { name: "Jake Kim", ticker: "JAKE", basePrice: 65, dateAdded: "2026-01-13T00:17:00" },
  { name: "Jaegyeon Na", ticker: "JAEG", basePrice: 62, dateAdded: "2026-01-13T00:18:00" },
  { name: "Yujae Seon", ticker: "YUJA", basePrice: 62, dateAdded: "2026-01-13T00:19:00" },
  { name: "Eli Jang", ticker: "ELI", basePrice: 60, dateAdded: "2026-01-13T00:20:00" },
  { name: "Samuel Seo", ticker: "SAM", basePrice: 60, dateAdded: "2026-01-13T00:21:00" },
  { name: "Taesoo Ma", ticker: "TM", basePrice: 60, dateAdded: "2026-01-13T00:22:00" },
  { name: "Gongseop Ji", ticker: "GONG", basePrice: 60, dateAdded: "2026-01-13T00:23:00", altNames: ["Gongseob Ji"] },
  { name: "Seongji Yuk", ticker: "6KNG", basePrice: 60, dateAdded: "2026-01-13T00:24:00" },
  { name: "Lang Jin", ticker: "WOLF", basePrice: 60, dateAdded: "2026-01-13T00:25:00", altNames: ["Jinrang"] },
  { name: "J", ticker: "COP", basePrice: 60, dateAdded: "2026-01-13T00:26:00" },
  { name: "Vin Jin", ticker: "VIN", basePrice: 57, dateAdded: "2026-01-13T00:27:00" },
  { name: "Vasco", ticker: "VSCO", basePrice: 55, dateAdded: "2026-01-13T00:28:00", altNames: ["Euntae Lee"] },
  { name: "Zack Lee", ticker: "ZACK", basePrice: 55, dateAdded: "2026-01-13T00:29:00" },
  { name: "Ryuhei Kuroda", ticker: "NOMN", basePrice: 55, dateAdded: "2026-01-13T00:30:00" },
  { name: "Yuseong", ticker: "CAPG", basePrice: 50, dateAdded: "2026-01-13T00:31:00", altNames: ["Cap Guy"] },
  { name: "Mandeok Bang", ticker: "BANG", basePrice: 50, dateAdded: "2026-01-13T00:32:00" },
  { name: "Jichang Kwak", ticker: "SNEK", basePrice: 50, dateAdded: "2026-01-13T00:33:00" },
  { name: "Seokdu Wang", ticker: "SEOK", basePrice: 50, dateAdded: "2026-01-13T00:34:00" },
  { name: "Sinu Han", ticker: "SINU", basePrice: 48, dateAdded: "2026-01-13T00:35:00" },
  { name: "Warren Chae", ticker: "CHAE", basePrice: 48, dateAdded: "2026-01-13T00:36:00" },
  { name: "Jerry Kwon", ticker: "SWRD", basePrice: 48, dateAdded: "2026-01-13T00:37:00" },
  { name: "Xiaolung", ticker: "XIAO", basePrice: 40, dateAdded: "2026-01-13T00:38:00" },
  { name: "Hudson Ahn", ticker: "AHN", basePrice: 38, dateAdded: "2026-01-13T00:39:00" },
  { name: "Jay Hong", ticker: "JAY", basePrice: 30, dateAdded: "2026-01-13T00:40:00" },
  { name: "Logan Lee", ticker: "LOGN", basePrice: 30, dateAdded: "2026-01-13T00:41:00" },
  { name: "Eugene", ticker: "WRKR", basePrice: 26, dateAdded: "2026-01-13T00:42:00", altNames: ["Yoojin"] },
  { name: "Crystal Choi", ticker: "CRYS", basePrice: 25, dateAdded: "2026-01-13T00:43:00" },
  { name: "Olly Wang", ticker: "OLLY", basePrice: 20, dateAdded: "2026-01-13T00:44:00" },
  { name: "Brad Lee", ticker: "BRAD", basePrice: 18, dateAdded: "2026-01-13T00:45:00" },
  { name: "Jason Yoon", ticker: "JSN", basePrice: 16, dateAdded: "2026-01-13T00:46:00" },
  { name: "Lineman", ticker: "LINE", basePrice: 15, dateAdded: "2026-01-13T00:47:00" },
  { name: "Jace Park", ticker: "JACE", basePrice: 14, dateAdded: "2026-01-13T00:48:00" },
  { name: "Sally Park", ticker: "SLLY", basePrice: 13, dateAdded: "2026-01-13T00:49:00" },
  { name: "Mira Kim", ticker: "MIRA", basePrice: 12, dateAdded: "2026-01-13T00:50:00" },
  { name: "Zoe Park", ticker: "ZOE", basePrice: 11, dateAdded: "2026-01-13T00:51:00" },
  { name: "Doo Lee", ticker: "DOO", basePrice: 10, dateAdded: "2026-01-13T00:52:00" },
  { name: "Jiho Park", ticker: "JIHO", basePrice: 7, dateAdded: "2026-01-13T00:53:00" },
  
  // New characters added 2026-01-16
  { name: "Seonhui Park", ticker: "MOM", basePrice: 15, dateAdded: "2026-01-16T00:00:00" },
  { name: "Joy Hong", ticker: "JOY", basePrice: 10, dateAdded: "2026-01-16T00:01:00" },
  { name: "Kouji", ticker: "HACK", basePrice: 12, dateAdded: "2026-01-16T00:02:00" },
  { name: "Mary Kim", ticker: "2SEC", basePrice: 25, dateAdded: "2026-01-16T00:03:00" },
  { name: "Duke Pyeon", ticker: "DUKE", basePrice: 20, dateAdded: "2026-01-16T00:04:00" },
  { name: "Baekho Kwon", ticker: "KWON", basePrice: 70, dateAdded: "2026-01-16T00:05:00" },
  { name: "Lightning Choi", ticker: "DNCE", basePrice: 30, dateAdded: "2026-01-16T00:06:00" },
  { name: "Gentleman", ticker: "GNTL", basePrice: 50, dateAdded: "2026-01-16T00:07:00", altNames: ["Chilbok Kang"] },
  { name: "Shigeaki Kojima", ticker: "SHKO", basePrice: 40, dateAdded: "2026-01-16T00:08:00" },
  { name: "Hiroaki Kojima", ticker: "HIKO", basePrice: 40, dateAdded: "2026-01-16T00:09:00" },
  { name: "Yugang Ha", ticker: "INCH", basePrice: 60, dateAdded: "2026-01-16T00:10:00" },
  { name: "Yeonwoo Kim", ticker: "MISS", basePrice: 40, dateAdded: "2026-01-16T00:11:00", altNames: ["Reporter Kim"] },
  { name: "Doksu Heo", ticker: "PYNG", basePrice: 40, dateAdded: "2026-01-16T00:12:00" },
  { name: "Jinyoung Go", ticker: "SNAM", basePrice: 40, dateAdded: "2026-01-16T00:13:00" },
  { name: "Mugeon Jang", ticker: "SAMC", basePrice: 40, dateAdded: "2026-01-16T00:14:00" },
  { name: "Seungwu Han", ticker: "YONG", basePrice: 40, dateAdded: "2026-01-16T00:15:00" },
  { name: "Siheon Choi", ticker: "PAJU", basePrice: 40, dateAdded: "2026-01-16T00:16:00" },
  { name: "Museok Jang", ticker: "PHNG", basePrice: 40, dateAdded: "2026-01-16T00:17:00" },
  { name: "BJ Showbu", ticker: "BUCH", basePrice: 45, dateAdded: "2026-01-16T00:18:00" },
  { name: "Juhyeok Eun", ticker: "UJBU", basePrice: 40, dateAdded: "2026-01-16T00:19:00" },
  { name: "Jaemin Noh", ticker: "DAEJ", basePrice: 40, dateAdded: "2026-01-16T00:20:00" },
  { name: "Sang Baek", ticker: "SHRK", basePrice: 35, dateAdded: "2026-01-16T00:21:00" },
  { name: "Jungseok Hwang", ticker: "BUS3", basePrice: 35, dateAdded: "2026-01-16T00:22:00" },
  { name: "Mugak Wang", ticker: "BEAD", basePrice: 30, dateAdded: "2026-01-16T00:23:00" },
  { name: "Juan Ryu", ticker: "TWHK", basePrice: 30, dateAdded: "2026-01-16T00:24:00" },
  { name: "Jamal Rahid", ticker: "JMAL", basePrice: 25, dateAdded: "2026-01-16T00:25:00" },
  { name: "Yeoul Ha", ticker: "YEUL", basePrice: 35, dateAdded: "2026-01-16T00:26:00" },
  { name: "Mitsuki Soma", ticker: "NEKO", basePrice: 20, dateAdded: "2026-01-16T00:27:00" },
  { name: "Darius Hong", ticker: "DOOR", basePrice: 15, dateAdded: "2026-01-16T00:28:00" },
  { name: "Jin Jang", ticker: "JINJ", basePrice: 15, dateAdded: "2026-01-16T00:29:00" },
  { name: "Kenta Magami", ticker: "DRMA", basePrice: 15, dateAdded: "2026-01-16T00:30:00" },
  { name: "Sato Kazuma", ticker: "HYOT", basePrice: 15, dateAdded: "2026-01-16T00:31:00" },
  { name: "Vivi", ticker: "CLUB", basePrice: 15, dateAdded: "2026-01-16T00:32:00" },
  { name: "Alexander Hwang", ticker: "ALEX", basePrice: 10, dateAdded: "2026-01-16T00:33:00" },
  { name: "Taejin Cheon", ticker: "SHMN", basePrice: 65, dateAdded: "2026-01-16T00:34:00" },
  { name: "Hangyeol Baek", ticker: "NO1", basePrice: 35, dateAdded: "2026-01-16T00:35:00" },
  { name: "Luah Lim", ticker: "LUAH", basePrice: 20, dateAdded: "2026-01-16T00:36:00" },
  { name: "Old Face", ticker: "OLDF", basePrice: 10, dateAdded: "2026-01-16T00:37:00" },
  { name: "Max Kang", ticker: "MAX", basePrice: 15, dateAdded: "2026-01-16T00:38:00" },
  { name: "Derrick Jo", ticker: "DJO", basePrice: 15, dateAdded: "2026-01-16T00:39:00" },
  { name: "Yenna Jang", ticker: "ZAMI", basePrice: 10, dateAdded: "2026-01-16T00:40:00" },
  { name: "Ryan the Cat", ticker: "RYAN", basePrice: 10, dateAdded: "2026-01-16T00:41:00" },
  { name: "Sanghui Han", ticker: "SGUI", basePrice: 10, dateAdded: "2026-01-16T00:42:00" },
  { name: "Yeongcheol Kim", ticker: "YCHL", basePrice: 10, dateAdded: "2026-01-16T00:43:00" },
  { name: "Sera Shin", ticker: "SERA", basePrice: 20, dateAdded: "2026-01-16T00:44:00" },

  // New characters added 2026-01-24
  { name: "Somi Park", ticker: "SOMI", basePrice: 15, dateAdded: "2026-01-24T00:00:00" },
  { name: "Gwang Yu", ticker: "MMA", basePrice: 17.50, dateAdded: "2026-01-24T00:01:00" },
  { name: "Beolgu Lee", ticker: "LIAR", basePrice: 15, dateAdded: "2026-01-24T00:02:00" },
  { name: "Jaesu Noh", ticker: "NOH", basePrice: 13, dateAdded: "2026-01-24T00:03:00" },
  { name: "Gyeol Baek", ticker: "DOC", basePrice: 12.50, dateAdded: "2026-01-24T00:04:00" },
  { name: "Sujin Kim", ticker: "SUJN", basePrice: 15, dateAdded: "2026-01-24T00:05:00" },
  { name: "Byeon Kim", ticker: "LAW", basePrice: 30, dateAdded: "2026-01-24T00:06:00" },
  { name: "Jihan Kwak", ticker: "CHCH", basePrice: 30, dateAdded: "2026-01-24T00:07:00" },
  { name: "Jibeom Kwak", ticker: "BEOM", basePrice: 15, dateAdded: "2026-01-24T00:08:00" },

  // New characters added 2026-01-26
  { name: "Brekdak", ticker: "MUAY", basePrice: 70, dateAdded: "2026-01-26T00:00:00" },

  // New characters added 2026-04-23
  { name: "Sangcheol Park", ticker: "DAD", basePrice: 30, dateAdded: "2026-04-23T00:00:00" },

  // New characters added 2026-04-25
  { name: "Enu", ticker: "ENU", basePrice: 10, dateAdded: "2026-04-25T00:00:00" },
  { name: "Miro", ticker: "MIRO", basePrice: 10, dateAdded: "2026-04-25T00:01:00" },
  { name: "Eden", ticker: "EDEN", basePrice: 12.50, dateAdded: "2026-04-25T00:02:00" },

  // New characters added 2026-05-01
  { name: "Gangnam Landlord", ticker: "LAND", basePrice: 5, dateAdded: "2026-05-01T00:00:00" },
  { name: "Chang-i Seo", ticker: "SWMP", basePrice: 45, dateAdded: "2026-05-01T00:01:00", altNames: ["Swamp Genius", "Changyi Seo"] },
  { name: "Chilsu Kang", ticker: "JEON", basePrice: 35, dateAdded: "2026-05-01T00:02:00" },
  { name: "Youngjin Jin", ticker: "SCHN", basePrice: 35, dateAdded: "2026-05-01T00:03:00" },
  { name: "Dongchun Bae", ticker: "SIN", basePrice: 35, dateAdded: "2026-05-01T00:04:00" },
  { name: "Minyong Park", ticker: "DOC2", basePrice: 7.50, dateAdded: "2026-05-01T00:05:00" },
  { name: "Haeshik Won", ticker: "TONG", basePrice: 30, dateAdded: "2026-05-14T00:00:00" },

  // New characters added 2026-06-01
  { name: "Chunhui Oh", ticker: "CHUN", basePrice: 7.50, dateAdded: "2026-06-01T00:00:00" },
  { name: "Isu Jo", ticker: "ISU", basePrice: 10, dateAdded: "2026-06-01T00:01:00" },
  { name: "Steve Hong", ticker: "HONG", basePrice: 12.50, dateAdded: "2026-06-01T00:02:00" },
  { name: "Bakgu Noh", ticker: "TAXI", basePrice: 12.50, dateAdded: "2026-06-01T00:03:00" },
  { name: "Tae-Oh Jang", ticker: "TAEJ", basePrice: 12.50, dateAdded: "2026-06-01T00:04:00" },
  { name: "Hwasu Park", ticker: "HPRK", basePrice: 12.50, dateAdded: "2026-06-01T00:05:00" },
  { name: "Myeongho Choi", ticker: "SNGH", basePrice: 15, dateAdded: "2026-06-01T00:06:00" },

  // New characters added 2026-06-04
  { name: "Taeguk Han", ticker: "HANT", basePrice: 15, dateAdded: "2026-06-04T00:00:00" },
  { name: "Gon Kwon", ticker: "GWON", basePrice: 15, dateAdded: "2026-06-04T00:01:00" },
  { name: "Minsik Choi", ticker: "MNSK", basePrice: 10, dateAdded: "2026-06-04T00:02:00" },
  { name: "Yuri Park", ticker: "AUNT", basePrice: 10, dateAdded: "2026-06-04T00:03:00" },

  // New characters added 2026-07-02
  { name: "Takeshi Saejima", ticker: "IJA", basePrice: 12.5, dateAdded: "2026-07-02T00:00:00" },
  { name: "Kenji Gonda", ticker: "KMSH", basePrice: 12.5, dateAdded: "2026-07-02T00:01:00" },
  { name: "Reiji Madarame", ticker: "SUMO", basePrice: 12.5, dateAdded: "2026-07-02T00:02:00" },

  // New characters added 2026-07-23
  { name: "Shinji Yamazaki", ticker: "OYA", basePrice: 85, dateAdded: "2026-07-23T00:00:00" },

  // IPO characters - require IPO process before trading
  { name: "Baekgeon Ryu", ticker: "RYU", basePrice: 55, dateAdded: "2026-02-12T00:00:00", ipoRequired: true },
  { name: "Eunha Lee", ticker: "EUNH", basePrice: 30, dateAdded: "2026-05-28T00:00:00", ipoRequired: true },
  { name: "Bangho Lee", ticker: "MONO", basePrice: 80, dateAdded: "2026-06-04T00:04:00", ipoRequired: true },
  { name: "Genjo Yamazaki", ticker: "YADV", basePrice: 80, dateAdded: "2026-06-25T00:00:00", ipoRequired: true },
  { name: "Rei Yamazaki", ticker: "REI", basePrice: 20, dateAdded: "2026-07-02T00:03:00", ipoRequired: true },

  // ETFs - crew-based funds (price = sum of member base prices / 5)
  {
    name: "Allied Fund", ticker: "ALLY", basePrice: 78, dateAdded: "2026-02-20T00:00:00",
    isETF: true, description: "Allied ETF",
    constituents: ["BDNL", "LDNL", "VSCO", "ZACK", "JAY", "VIN", "AHN"],
    trailingFactors: [
      { ticker: "BDNL", coefficient: 0.114 }, { ticker: "LDNL", coefficient: 0.114 },
      { ticker: "VSCO", coefficient: 0.114 }, { ticker: "ZACK", coefficient: 0.114 },
      { ticker: "JAY", coefficient: 0.114 }, { ticker: "VIN", coefficient: 0.114 },
      { ticker: "AHN", coefficient: 0.114 }
    ]
  },
  {
    name: "Big Deal Fund", ticker: "DEAL", basePrice: 46, dateAdded: "2026-02-20T00:01:00",
    isETF: true, description: "Big Deal ETF",
    constituents: ["JAKE", "SWRD", "JSN", "BRAD", "LINE", "SINU", "LUAH"],
    trailingFactors: [
      { ticker: "JAKE", coefficient: 0.114 }, { ticker: "SWRD", coefficient: 0.114 },
      { ticker: "JSN", coefficient: 0.114 }, { ticker: "BRAD", coefficient: 0.114 },
      { ticker: "LINE", coefficient: 0.114 }, { ticker: "SINU", coefficient: 0.114 },
      { ticker: "LUAH", coefficient: 0.114 }
    ]
  },
  {
    name: "Fist Gang Fund", ticker: "FIST", basePrice: 100.5, dateAdded: "2026-02-20T00:02:00",
    isETF: true, description: "Fist Gang ETF",
    constituents: ["GAP", "ELIT", "JYNG", "TOM", "KWON", "DNCE", "GNTL", "MMA", "LIAR", "NOH", "TAXI", "HANT", "GWON"],
    trailingFactors: [
      { ticker: "GAP", coefficient: 0.062 }, { ticker: "ELIT", coefficient: 0.062 },
      { ticker: "JYNG", coefficient: 0.062 }, { ticker: "TOM", coefficient: 0.062 },
      { ticker: "KWON", coefficient: 0.062 }, { ticker: "DNCE", coefficient: 0.062 },
      { ticker: "GNTL", coefficient: 0.062 }, { ticker: "MMA", coefficient: 0.062 },
      { ticker: "LIAR", coefficient: 0.062 }, { ticker: "NOH", coefficient: 0.062 },
      { ticker: "TAXI", coefficient: 0.062 }, { ticker: "HANT", coefficient: 0.062 },
      { ticker: "GWON", coefficient: 0.062 }
    ]
  },
  {
    name: "Secret Friends Fund", ticker: "SCRT", basePrice: 50, dateAdded: "2026-02-20T00:03:00",
    isETF: true, description: "Secret Friends ETF",
    constituents: ["GOO", "LOGN", "SAM", "ALEX", "SHMN"],
    trailingFactors: [
      { ticker: "GOO", coefficient: 0.16 }, { ticker: "LOGN", coefficient: 0.16 },
      { ticker: "SAM", coefficient: 0.16 }, { ticker: "ALEX", coefficient: 0.16 },
      { ticker: "SHMN", coefficient: 0.16 }
    ]
  },
  {
    name: "Hostel Fund", ticker: "HSTL", basePrice: 34.2, dateAdded: "2026-02-20T00:04:00",
    isETF: true, description: "Hostel ETF",
    constituents: ["ELI", "SLLY", "CHAE", "MAX", "DJO", "ZAMI", "RYAN"],
    trailingFactors: [
      { ticker: "ELI", coefficient: 0.114 }, { ticker: "SLLY", coefficient: 0.114 },
      { ticker: "CHAE", coefficient: 0.114 }, { ticker: "MAX", coefficient: 0.114 },
      { ticker: "DJO", coefficient: 0.114 }, { ticker: "ZAMI", coefficient: 0.114 },
      { ticker: "RYAN", coefficient: 0.114 }
    ]
  },
  {
    name: "WTJC Fund", ticker: "WTJC", basePrice: 47.5, dateAdded: "2026-02-20T00:05:00",
    isETF: true, description: "WTJC ETF",
    constituents: ["TOM", "SRMK", "SGUI", "YCHL", "SERA", "MMA", "LIAR", "NOH"],
    trailingFactors: [
      { ticker: "TOM", coefficient: 0.10 }, { ticker: "SRMK", coefficient: 0.10 },
      { ticker: "SGUI", coefficient: 0.10 }, { ticker: "YCHL", coefficient: 0.10 },
      { ticker: "SERA", coefficient: 0.10 }, { ticker: "MMA", coefficient: 0.10 },
      { ticker: "LIAR", coefficient: 0.10 }, { ticker: "NOH", coefficient: 0.10 }
    ]
  },
  {
    name: "Workers Fund", ticker: "VVIP", basePrice: 94.1, dateAdded: "2026-02-20T00:06:00",
    isETF: true, description: "Workers ETF",
    constituents: ["WRKR", "BANG", "CAPG", "JYNG", "NOMN", "NEKO", "DOOR", "JINJ", "DRMA", "HYOT", "OLDF", "SHKO", "HIKO", "DOC", "NO1", "DOC2", "TAEJ", "HPRK", "SNGH"],
    trailingFactors: [
      { ticker: "WRKR", coefficient: 0.042 }, { ticker: "BANG", coefficient: 0.042 },
      { ticker: "CAPG", coefficient: 0.042 }, { ticker: "JYNG", coefficient: 0.042 },
      { ticker: "NOMN", coefficient: 0.042 }, { ticker: "NEKO", coefficient: 0.042 },
      { ticker: "DOOR", coefficient: 0.042 }, { ticker: "JINJ", coefficient: 0.042 },
      { ticker: "DRMA", coefficient: 0.042 }, { ticker: "HYOT", coefficient: 0.042 },
      { ticker: "OLDF", coefficient: 0.042 }, { ticker: "SHKO", coefficient: 0.042 },
      { ticker: "HIKO", coefficient: 0.042 }, { ticker: "DOC", coefficient: 0.042 },
      { ticker: "NO1", coefficient: 0.042 }, { ticker: "DOC2", coefficient: 0.042 },
      { ticker: "TAEJ", coefficient: 0.042 }, { ticker: "HPRK", coefficient: 0.042 },
      { ticker: "SNGH", coefficient: 0.042 }
    ]
  },
  {
    name: "Yamazaki Fund", ticker: "YAMA", basePrice: 84, dateAdded: "2026-02-20T00:07:00",
    isETF: true, description: "Yamazaki ETF",
    constituents: ["GUN", "SHNG", "SHRO", "SHKO", "HIKO", "SOMI", "YADV", "REI", "IJA", "KMSH", "SUMO", "OYA"],
    trailingFactors: [
      { ticker: "GUN", coefficient: 0.067 }, { ticker: "SHNG", coefficient: 0.067 },
      { ticker: "SHRO", coefficient: 0.067 }, { ticker: "SHKO", coefficient: 0.067 },
      { ticker: "HIKO", coefficient: 0.067 }, { ticker: "SOMI", coefficient: 0.067 },
      { ticker: "YADV", coefficient: 0.067 }, { ticker: "REI", coefficient: 0.067 },
      { ticker: "IJA", coefficient: 0.067 }, { ticker: "KMSH", coefficient: 0.067 },
      { ticker: "SUMO", coefficient: 0.067 }, { ticker: "OYA", coefficient: 0.067 }
    ]
  },
  {
    name: "J High School ETF", ticker: "JWON", basePrice: 117.20, dateAdded: "2026-02-20T00:08:00",
    isETF: true, description: "J High School ETF",
    constituents: ["BDNL", "LDNL", "ELI", "ZACK", "VSCO", "VIN", "JAY", "LOGN", "2SEC", "CRYS", "DUKE", "DOO", "JACE", "MIRA", "ZOE", "JOY", "JIHO", "ENU"],
    trailingFactors: [
      { ticker: "BDNL", coefficient: 0.047 }, { ticker: "LDNL", coefficient: 0.047 },
      { ticker: "ELI", coefficient: 0.047 }, { ticker: "ZACK", coefficient: 0.047 },
      { ticker: "VSCO", coefficient: 0.047 }, { ticker: "VIN", coefficient: 0.047 },
      { ticker: "JAY", coefficient: 0.047 }, { ticker: "LOGN", coefficient: 0.047 },
      { ticker: "2SEC", coefficient: 0.047 }, { ticker: "CRYS", coefficient: 0.047 },
      { ticker: "DUKE", coefficient: 0.047 }, { ticker: "DOO", coefficient: 0.047 },
      { ticker: "JACE", coefficient: 0.047 }, { ticker: "MIRA", coefficient: 0.047 },
      { ticker: "ZOE", coefficient: 0.047 }, { ticker: "JOY", coefficient: 0.047 },
      { ticker: "JIHO", coefficient: 0.047 }, { ticker: "ENU", coefficient: 0.047 }
    ]
  },
  {
    name: "Kitae Kim Alliance ETF", ticker: "SHDW", basePrice: 155, dateAdded: "2026-02-20T00:09:00",
    isETF: true, description: "Kitae Kim Alliance ETF",
    constituents: ["KTAE", "DG", "GNTL", "GOO", "SAM", "SHMN", "SAMC", "YONG", "PAJU", "PHNG", "CROW", "COP", "RYU", "SWMP", "JEON", "SCHN", "SIN", "TONG", "ISU"],
    trailingFactors: [
      { ticker: "KTAE", coefficient: 0.042 }, { ticker: "DG", coefficient: 0.042 },
      { ticker: "GNTL", coefficient: 0.042 }, { ticker: "GOO", coefficient: 0.042 },
      { ticker: "SAM", coefficient: 0.042 }, { ticker: "SHMN", coefficient: 0.042 },
      { ticker: "SAMC", coefficient: 0.042 }, { ticker: "YONG", coefficient: 0.042 },
      { ticker: "PAJU", coefficient: 0.042 }, { ticker: "PHNG", coefficient: 0.042 },
      { ticker: "CROW", coefficient: 0.042 }, { ticker: "COP", coefficient: 0.042 },
      { ticker: "RYU", coefficient: 0.042 }, { ticker: "SWMP", coefficient: 0.042 },
      { ticker: "JEON", coefficient: 0.042 }, { ticker: "SCHN", coefficient: 0.042 },
      { ticker: "SIN", coefficient: 0.042 }, { ticker: "TONG", coefficient: 0.042 },
      { ticker: "ISU", coefficient: 0.042 }
    ]
  },
  { name: "James Gong", ticker: "JGNG", basePrice: 12.50, dateAdded: "2026-05-25T00:00:00" },
  {
    name: "Jake Kim Alliance ETF", ticker: "JKAL", basePrice: 137.40, dateAdded: "2026-02-20T00:10:00",
    isETF: true, description: "Jake Kim Alliance ETF",
    constituents: ["JAKE", "LINE", "BDNL", "LDNL", "TM", "GONG", "SEOK", "WOLF", "JAEG", "YEUL", "BUCH", "UJBU", "DAEJ"],
    trailingFactors: [
      { ticker: "JAKE", coefficient: 0.062 }, { ticker: "LINE", coefficient: 0.062 },
      { ticker: "BDNL", coefficient: 0.062 }, { ticker: "LDNL", coefficient: 0.062 },
      { ticker: "TM", coefficient: 0.062 }, { ticker: "GONG", coefficient: 0.062 },
      { ticker: "SEOK", coefficient: 0.062 }, { ticker: "WOLF", coefficient: 0.062 },
      { ticker: "JAEG", coefficient: 0.062 }, { ticker: "YEUL", coefficient: 0.062 },
      { ticker: "BUCH", coefficient: 0.062 }, { ticker: "UJBU", coefficient: 0.062 },
      { ticker: "DAEJ", coefficient: 0.062 }
    ]
  },
];

// Create a map for quick lookup
export const CHARACTER_MAP = {};
CHARACTERS.forEach(c => {
  CHARACTER_MAP[c.ticker] = c;
});

// ============================================
// MARKET STANDING (rarity tiers)
// ============================================
// This algorithm lives here (not in src/utils/) because the backend needs the
// exact same tier math: npm run sync:chars copies this file to functions/, and
// the dividend payout runs it on the frozen pre-halt price snapshot. The
// frontend re-exports it from src/utils/rarity.js.
//
// A character's tier is its STANDING in the live market, not a fixed dollar
// price. Rank every non-ETF character by current price, slice the ranking into
// tiers by position, then nudge each tier boundary onto the nearest natural
// price gap so a boundary never cuts through a tight price cluster.

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// Cumulative share of the roster, counting from the most expensive character down.
const TIER_CUTOFFS = [
  { tier: 'legendary', maxFraction: 0.04 },
  { tier: 'epic',      maxFraction: 0.16 },
  { tier: 'rare',      maxFraction: 0.41 },
  { tier: 'uncommon',  maxFraction: 0.76 },
  { tier: 'common',    maxFraction: Infinity },
];

// Gap snapping — how far a boundary may slide off its rank cutoff, and what
// counts as a "clear break" worth sliding to.
const GAP_WINDOW_DOWN = 4;   // slots a boundary may slide down (rounding characters UP into the higher tier)
const GAP_WINDOW_UP = 5;     // slots it may retreat up when the cluster extends past the down-window
const GAP_BREAK_RATIO = 1.2; // a break must beat every gap it skips over by this factor
const MIN_BREAK_GAP = 0.008; // ...and be at least a 0.8% relative price drop (ignores cluster noise)

// Relative price drop between rank c-1 and rank c (prices are sorted descending).
const relativeGap = (ranked, c) => {
  const above = ranked[c - 1].price;
  return above > 0 ? (above - ranked[c].price) / above : 0;
};

// Slide one tier boundary from its nominal rank cutoff onto a natural price gap.
// Walk down first (preferring to round borderline characters up into the higher
// tier) and stop at the first clear break; if the cluster runs past the window,
// fall back to walking up to the break above. `prev` (the boundary of the tier
// above) is a hard floor so tiers can never overlap or reorder.
const snapBoundary = (ranked, nominal, prev, upperSize, lowerSize) => {
  const n = ranked.length;
  const base = Math.min(Math.max(nominal, prev + 1), n);
  if (base >= n) return base;

  // Cap the windows by tier size so a snap can't swallow half a neighboring tier.
  const down = Math.min(GAP_WINDOW_DOWN, Math.floor(lowerSize / 2));
  const up = Math.min(GAP_WINDOW_UP, Math.floor(upperSize / 2));

  // Scan candidates one slot at a time. A candidate is a break when its gap
  // clears the noise floor and beats every gap skipped so far by the ratio.
  // After a break is found, keep sliding only while the very next candidate is
  // an even clearer break; stop at the first that isn't.
  const scanForBreak = (from, to, step) => {
    let maxSkipped = relativeGap(ranked, base);
    let breakAt = 0;
    let breakGap = 0;
    for (let c = from; step > 0 ? c <= to : c >= to; c += step) {
      const gap = relativeGap(ranked, c);
      if (breakAt) {
        if (gap < GAP_BREAK_RATIO * breakGap) break;
      } else if (gap < MIN_BREAK_GAP || gap < GAP_BREAK_RATIO * maxSkipped) {
        maxSkipped = Math.max(maxSkipped, gap);
        continue;
      }
      breakAt = c;
      breakGap = gap;
    }
    return breakAt;
  };

  return (
    scanForBreak(base + 1, Math.min(base + down, n - 1), 1) ||
    scanForBreak(base - 1, Math.max(base - up, prev + 1), -1) ||
    base
  );
};

/**
 * Build a { ticker: tier } map from a price map (live prices on the frontend,
 * the pre-halt snapshot in the dividend payout). ETFs are excluded, so ETF
 * tickers simply won't appear as keys.
 */
export const computeRarityTiers = (characters, prices) => {
  const ranked = characters
    .filter((c) => !c.isETF)
    .map((c) => ({
      ticker: c.ticker,
      price: prices?.[c.ticker] ?? c.basePrice ?? 0,
    }))
    // Highest price first; ticker breaks ties so equal prices never reshuffle.
    .sort((a, b) => b.price - a.price || (a.ticker < b.ticker ? -1 : 1));

  const n = ranked.length;
  const tiers = {};
  if (!n) return tiers;

  const nominals = TIER_CUTOFFS.slice(0, -1).map((t) => Math.ceil(t.maxFraction * n));

  const bounds = [];
  let prev = 0;
  nominals.forEach((nominal, i) => {
    const upperSize = nominal - (i ? nominals[i - 1] : 0);
    const lowerSize = (i + 1 < nominals.length ? nominals[i + 1] : n) - nominal;
    prev = snapBoundary(ranked, nominal, prev, upperSize, lowerSize);
    bounds.push(prev);
  });

  ranked.forEach((entry, idx) => {
    const k = bounds.findIndex((b) => idx < b);
    tiers[entry.ticker] = (k === -1 ? TIER_CUTOFFS[TIER_CUTOFFS.length - 1] : TIER_CUTOFFS[k]).tier;
  });
  return tiers;
};

// ============================================
// DIVIDEND SYSTEM
// ============================================
// Every stock pays a weekly dividend (Thursday 12:58 UTC, on the frozen
// pre-halt snapshot so payout prices are non-gameable). The base yield is the
// stock's rarity tier — its live market standing — so blue-chip rates follow
// the market automatically. ETFs pay a flat mid-tier rate. Admin can still
// override any ticker via Firestore dividendConfig/tierOverrides ('none'
// forces 0%).
//
// On top of the base yield, each purchase lot climbs a loyalty ladder the
// longer it is held. Under DIVIDEND_HOLD_DAYS a lot pays nothing (blocks
// buy-before-payout farming); it then steps up to a 1.5x multiplier at 8 weeks.
// Sanity anchor: max yield (legendary at 1.5x = 1.5%/week) stays well under
// margin interest (0.5%/day), so borrowing to farm dividends always loses.

export const DIVIDEND_HOLD_DAYS = 10;
export const DIVIDEND_HOLD_MS = DIVIDEND_HOLD_DAYS * 24 * 60 * 60 * 1000;

// Weekly base yield per tier, applied to (eligible shares × snapshot price).
export const DIVIDEND_RATES = {
  legendary: 0.010,  // 1.00% / week
  epic:      0.008,  // 0.80% / week
  rare:      0.006,  // 0.60% / week
  uncommon:  0.0045, // 0.45% / week
  common:    0.003,  // 0.30% / week
  etf:       0.007,  // 0.70% / week (flat, tier-independent)
  none:      0,      // admin override: stock pays nothing
};

// Admin override values written before the tier revamp map onto the new tiers.
const LEGACY_TIER_ALIASES = {
  'blue-chip': 'legendary',
  'dividend':  'uncommon',
  'growth':    'none',
};

// Loyalty ladder, checked top rung first. A lot younger than DIVIDEND_HOLD_DAYS
// pays nothing.
export const DIVIDEND_LOYALTY_LADDER = [
  { minDays: 56, multiplier: 1.5 },  // 8+ weeks
  { minDays: 28, multiplier: 1.25 }, // 4-8 weeks
  { minDays: DIVIDEND_HOLD_DAYS, multiplier: 1.0 },
];
export const DIVIDEND_MAX_MULTIPLIER = DIVIDEND_LOYALTY_LADDER[0].multiplier;
export const DIVIDEND_MATURE_MS = DIVIDEND_LOYALTY_LADDER[0].minDays * 24 * 60 * 60 * 1000;

// When the loyalty ladder launched. `eligible` shares from before this date
// have unknown exact ages (the old system only tracked the 10-day gate), so
// they are treated as bought DIVIDEND_HOLD_DAYS before the epoch — the minimum
// they could have been held — and climb the ladder from there. No free 1.5x.
// Shares that genuinely mature (56d) fold into `eligible` no earlier than the
// epoch ladder reaches 1.5x, so this stamp never underpays a real graduate.
export const DIVIDEND_LADDER_EPOCH = Date.UTC(2026, 6, 19); // 2026-07-19 00:00 UTC
const LEGACY_ELIGIBLE_ACQUIRED_AT = DIVIDEND_LADDER_EPOCH - DIVIDEND_HOLD_MS;

export const dividendMultiplierForAgeMs = (ageMs) => {
  const days = ageMs / (24 * 60 * 60 * 1000);
  const rung = DIVIDEND_LOYALTY_LADDER.find((r) => days >= r.minDays);
  return rung ? rung.multiplier : 0;
};

/**
 * Resolve a ticker's dividend tier name. `rarityTiers` is the output of
 * computeRarityTiers for whatever price set applies (live or snapshot);
 * `overrides` is the admin map from dividendConfig/tierOverrides.
 */
export const getDividendTier = (ticker, rarityTiers = {}, overrides = {}) => {
  const char = CHARACTER_MAP[ticker];
  if (!char) return 'none';
  const override = overrides && overrides[ticker];
  if (override) return LEGACY_TIER_ALIASES[override] || override;
  if (char.isETF) return 'etf';
  return rarityTiers[ticker] || 'common';
};

export const getDividendRate = (ticker, rarityTiers, overrides) =>
  DIVIDEND_RATES[getDividendTier(ticker, rarityTiers, overrides)] || 0;

/**
 * Multiplier-weighted share count for one holding cohort at `now`.
 * `eligible` shares are aged from the ladder epoch (see above): legacy shares
 * climb the ladder from their minimum provable age instead of getting 1.5x
 * for free, and genuine 56-day graduates land after the epoch ladder is
 * already at 1.5x. Each pending lot uses its own age, derived from
 * availableAt - the hold gate. Weekly dividend = weightedShares × price × rate.
 */
export const dividendWeightedShares = (cohort, now) => {
  if (!cohort) return 0;
  let weighted = (cohort.eligible || 0) * dividendMultiplierForAgeMs(now - LEGACY_ELIGIBLE_ACQUIRED_AT);
  for (const p of (cohort.pending || [])) {
    const acquiredAt = (p.availableAt || 0) - DIVIDEND_HOLD_MS;
    weighted += (p.shares || 0) * dividendMultiplierForAgeMs(now - acquiredAt);
  }
  return weighted;
};
