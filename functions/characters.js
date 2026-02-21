// All Lookism characters with their base stats
// dateAdded: used for "Newest" / "Oldest" sorting - includes time for unique ordering
// Strongest characters = oldest (added first), Weakest = newest (added last)
export const CHARACTERS = [
  { name: "James Lee", ticker: "DG", basePrice: 85, volatility: 0.03, dateAdded: "2026-01-13T00:00:00" },
  {
    name: "Mujin Jin",
    ticker: "JIN",
    basePrice: 85,
    volatility: 0.03,
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
    volatility: 0.03,
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
    volatility: 0.03,
    dateAdded: "2026-01-13T00:02:00",
    trailingFactors: [
      { ticker: "SHNG", coefficient: 0.4 },
      { ticker: "JIN", coefficient: 0.4 },
      { ticker: "KTAE", coefficient: 0.2 },
      { ticker: "JAKE", coefficient: 0.2 }
    ]
  },
  { name: "Gun Park", ticker: "GUN", basePrice: 85, volatility: 0.035, dateAdded: "2026-01-13T00:03:00" },
  { name: "Goo Kim", ticker: "GOO", basePrice: 85, volatility: 0.035, dateAdded: "2026-01-13T00:04:00" },
  {
    name: "Daniel Park (Big)",
    ticker: "BDNL",
    basePrice: 85,
    volatility: 0.04,
    dateAdded: "2026-01-13T00:05:00",
    trailingFactors: [
      { ticker: "LDNL", coefficient: 0.3 }
    ]
  },
  { name: "Sophia Alexander", ticker: "SOPH", basePrice: 80, volatility: 0.035, dateAdded: "2026-01-13T00:06:00" },
  { name: "Kitae Kim", ticker: "KTAE", basePrice: 80, volatility: 0.035, dateAdded: "2026-01-13T00:07:00" },
  { name: "Johan Seong", ticker: "GDOG", basePrice: 80, volatility: 0.045, dateAdded: "2026-01-13T00:08:00" },
  { name: "Tom Lee", ticker: "TOM", basePrice: 78, volatility: 0.035, dateAdded: "2026-01-13T00:09:00" },
  { name: "Shintaro Yamazaki", ticker: "SHRO", basePrice: 75, volatility: 0.035, dateAdded: "2026-01-13T00:10:00" },
  { name: "Changsu Oh", ticker: "CROW", basePrice: 75, volatility: 0.035, dateAdded: "2026-01-13T00:11:00" },
  { name: "Manager Kim", ticker: "SRMK", basePrice: 74, volatility: 0.03, dateAdded: "2026-01-13T00:12:00" },
  { name: "Charles Choi", ticker: "ELIT", basePrice: 72, volatility: 0.025, dateAdded: "2026-01-13T00:13:00" },
  { name: "Jinyeong Park", ticker: "JYNG", basePrice: 72, volatility: 0.03, dateAdded: "2026-01-13T00:14:00" },
  {
    name: "Daniel Park (Small)",
    ticker: "LDNL",
    basePrice: 70,
    volatility: 0.05,
    dateAdded: "2026-01-13T00:15:00",
    trailingFactors: [
      { ticker: "BDNL", coefficient: 0.3 }
    ]
  },
  { name: "Paecheon Jo", ticker: "CROC", basePrice: 66, volatility: 0.03, dateAdded: "2026-01-13T00:16:00" },
  { name: "Jake Kim", ticker: "JAKE", basePrice: 65, volatility: 0.04, dateAdded: "2026-01-13T00:17:00" },
  { name: "Jaegyeon Na", ticker: "JAEG", basePrice: 62, volatility: 0.035, dateAdded: "2026-01-13T00:18:00" },
  { name: "Yujae Seon", ticker: "YUJA", basePrice: 62, volatility: 0.035, dateAdded: "2026-01-13T00:19:00" },
  { name: "Eli Jang", ticker: "ELI", basePrice: 60, volatility: 0.04, dateAdded: "2026-01-13T00:20:00" },
  { name: "Samuel Seo", ticker: "SAM", basePrice: 60, volatility: 0.04, dateAdded: "2026-01-13T00:21:00" },
  { name: "Taesoo Ma", ticker: "TM", basePrice: 60, volatility: 0.035, dateAdded: "2026-01-13T00:22:00" },
  { name: "Gongseop Ji", ticker: "GONG", basePrice: 60, volatility: 0.035, dateAdded: "2026-01-13T00:23:00" },
  { name: "Seongji Yuk", ticker: "6KNG", basePrice: 60, volatility: 0.04, dateAdded: "2026-01-13T00:24:00" },
  { name: "Lang Jin", ticker: "WOLF", basePrice: 60, volatility: 0.04, dateAdded: "2026-01-13T00:25:00" },
  { name: "J", ticker: "COP", basePrice: 60, volatility: 0.04, dateAdded: "2026-01-13T00:26:00" },
  { name: "Vin Jin", ticker: "VIN", basePrice: 57, volatility: 0.045, dateAdded: "2026-01-13T00:27:00" },
  { name: "Vasco", ticker: "VSCO", basePrice: 55, volatility: 0.04, dateAdded: "2026-01-13T00:28:00" },
  { name: "Zack Lee", ticker: "ZACK", basePrice: 55, volatility: 0.04, dateAdded: "2026-01-13T00:29:00" },
  { name: "Ryuhei Kuroda", ticker: "NOMN", basePrice: 55, volatility: 0.04, dateAdded: "2026-01-13T00:30:00" },
  { name: "Yuseong", ticker: "CAPG", basePrice: 50, volatility: 0.035, dateAdded: "2026-01-13T00:31:00" },
  { name: "Mandeok Bang", ticker: "BANG", basePrice: 50, volatility: 0.035, dateAdded: "2026-01-13T00:32:00" },
  { name: "Jichang Kwak", ticker: "SNEK", basePrice: 50, volatility: 0.04, dateAdded: "2026-01-13T00:33:00" },
  { name: "Seokdu Wang", ticker: "SEOK", basePrice: 50, volatility: 0.04, dateAdded: "2026-01-13T00:34:00" },
  { name: "Sinu Han", ticker: "SINU", basePrice: 48, volatility: 0.04, dateAdded: "2026-01-13T00:35:00" },
  { name: "Warren Chae", ticker: "CHAE", basePrice: 48, volatility: 0.04, dateAdded: "2026-01-13T00:36:00" },
  { name: "Jerry Kwon", ticker: "SWRD", basePrice: 48, volatility: 0.035, dateAdded: "2026-01-13T00:37:00" },
  { name: "Xiaolung", ticker: "XIAO", basePrice: 40, volatility: 0.04, dateAdded: "2026-01-13T00:38:00" },
  { name: "Hudson Ahn", ticker: "AHN", basePrice: 38, volatility: 0.035, dateAdded: "2026-01-13T00:39:00" },
  { name: "Jay Hong", ticker: "JAY", basePrice: 30, volatility: 0.03, dateAdded: "2026-01-13T00:40:00" },
  { name: "Logan Lee", ticker: "LOGN", basePrice: 30, volatility: 0.05, dateAdded: "2026-01-13T00:41:00" },
  { name: "Eugene", ticker: "WRKR", basePrice: 26, volatility: 0.03, dateAdded: "2026-01-13T00:42:00" },
  { name: "Crystal Choi", ticker: "CRYS", basePrice: 25, volatility: 0.03, dateAdded: "2026-01-13T00:43:00" },
  { name: "Olly Wang", ticker: "OLLY", basePrice: 20, volatility: 0.04, dateAdded: "2026-01-13T00:44:00" },
  { name: "Brad Lee", ticker: "BRAD", basePrice: 18, volatility: 0.035, dateAdded: "2026-01-13T00:45:00" },
  { name: "Jason Yoon", ticker: "JSN", basePrice: 16, volatility: 0.04, dateAdded: "2026-01-13T00:46:00" },
  { name: "Lineman", ticker: "LINE", basePrice: 15, volatility: 0.03, dateAdded: "2026-01-13T00:47:00" },
  { name: "Jace Park", ticker: "JACE", basePrice: 14, volatility: 0.035, dateAdded: "2026-01-13T00:48:00" },
  { name: "Sally Park", ticker: "SLLY", basePrice: 13, volatility: 0.03, dateAdded: "2026-01-13T00:49:00" },
  { name: "Mira Kim", ticker: "MIRA", basePrice: 12, volatility: 0.03, dateAdded: "2026-01-13T00:50:00" },
  { name: "Zoe Park", ticker: "ZOE", basePrice: 11, volatility: 0.03, dateAdded: "2026-01-13T00:51:00" },
  { name: "Doo Lee", ticker: "DOO", basePrice: 10, volatility: 0.04, dateAdded: "2026-01-13T00:52:00" },
  { name: "Jiho Park", ticker: "JIHO", basePrice: 7, volatility: 0.06, dateAdded: "2026-01-13T00:53:00" },
  
  // New characters added 2026-01-16
  { name: "Seonhui Park", ticker: "MOM", basePrice: 15, volatility: 0.03, dateAdded: "2026-01-16T00:00:00" },
  { name: "Joy Hong", ticker: "JOY", basePrice: 10, volatility: 0.03, dateAdded: "2026-01-16T00:01:00" },
  { name: "Kouji", ticker: "HACK", basePrice: 12, volatility: 0.035, dateAdded: "2026-01-16T00:02:00" },
  { name: "Mary Kim", ticker: "2SEC", basePrice: 25, volatility: 0.03, dateAdded: "2026-01-16T00:03:00" },
  { name: "Duke Pyeon", ticker: "DUKE", basePrice: 20, volatility: 0.035, dateAdded: "2026-01-16T00:04:00" },
  { name: "Baekho Kwon", ticker: "KWON", basePrice: 70, volatility: 0.035, dateAdded: "2026-01-16T00:05:00" },
  { name: "Lightning Choi", ticker: "DNCE", basePrice: 30, volatility: 0.04, dateAdded: "2026-01-16T00:06:00" },
  { name: "Gentleman", ticker: "GNTL", basePrice: 50, volatility: 0.035, dateAdded: "2026-01-16T00:07:00" },
  { name: "Shigeaki Kojima", ticker: "SHKO", basePrice: 40, volatility: 0.035, dateAdded: "2026-01-16T00:08:00" },
  { name: "Hiroaki Kojima", ticker: "HIKO", basePrice: 40, volatility: 0.035, dateAdded: "2026-01-16T00:09:00" },
  { name: "Yugang Ha", ticker: "INCH", basePrice: 60, volatility: 0.035, dateAdded: "2026-01-16T00:10:00" },
  { name: "Yeonwoo Kim", ticker: "MISS", basePrice: 40, volatility: 0.035, dateAdded: "2026-01-16T00:11:00" },
  { name: "Doksu Heo", ticker: "PYNG", basePrice: 40, volatility: 0.035, dateAdded: "2026-01-16T00:12:00" },
  { name: "Jinyoung Go", ticker: "SNAM", basePrice: 40, volatility: 0.035, dateAdded: "2026-01-16T00:13:00" },
  { name: "Mugeon Jang", ticker: "SAMC", basePrice: 40, volatility: 0.035, dateAdded: "2026-01-16T00:14:00" },
  { name: "Seungwu Han", ticker: "YONG", basePrice: 40, volatility: 0.035, dateAdded: "2026-01-16T00:15:00" },
  { name: "Siheon Choi", ticker: "PAJU", basePrice: 40, volatility: 0.035, dateAdded: "2026-01-16T00:16:00" },
  { name: "Museok Jang", ticker: "PHNG", basePrice: 40, volatility: 0.035, dateAdded: "2026-01-16T00:17:00" },
  { name: "BJ Showbu", ticker: "BUCH", basePrice: 45, volatility: 0.04, dateAdded: "2026-01-16T00:18:00" },
  { name: "Juhyeok Eun", ticker: "UJBU", basePrice: 40, volatility: 0.035, dateAdded: "2026-01-16T00:19:00" },
  { name: "Jaemin Noh", ticker: "DAEJ", basePrice: 40, volatility: 0.035, dateAdded: "2026-01-16T00:20:00" },
  { name: "Sang Baek", ticker: "SHRK", basePrice: 35, volatility: 0.04, dateAdded: "2026-01-16T00:21:00" },
  { name: "Jungseok Hwang", ticker: "BUS3", basePrice: 35, volatility: 0.035, dateAdded: "2026-01-16T00:22:00" },
  { name: "Mugak Wang", ticker: "BEAD", basePrice: 30, volatility: 0.035, dateAdded: "2026-01-16T00:23:00" },
  { name: "Juan Ryu", ticker: "TWHK", basePrice: 30, volatility: 0.035, dateAdded: "2026-01-16T00:24:00" },
  { name: "Jamal Rahid", ticker: "JMAL", basePrice: 25, volatility: 0.035, dateAdded: "2026-01-16T00:25:00" },
  { name: "Yeoul Ha", ticker: "YEUL", basePrice: 35, volatility: 0.035, dateAdded: "2026-01-16T00:26:00" },
  { name: "Mitsuki Soma", ticker: "NEKO", basePrice: 20, volatility: 0.035, dateAdded: "2026-01-16T00:27:00" },
  { name: "Darius Hong", ticker: "DOOR", basePrice: 15, volatility: 0.035, dateAdded: "2026-01-16T00:28:00" },
  { name: "Jin Jang", ticker: "JINJ", basePrice: 15, volatility: 0.035, dateAdded: "2026-01-16T00:29:00" },
  { name: "Kenta Magami", ticker: "DRMA", basePrice: 15, volatility: 0.035, dateAdded: "2026-01-16T00:30:00" },
  { name: "Sato Kazuma", ticker: "HYOT", basePrice: 15, volatility: 0.035, dateAdded: "2026-01-16T00:31:00" },
  { name: "Vivi", ticker: "CLUB", basePrice: 15, volatility: 0.03, dateAdded: "2026-01-16T00:32:00" },
  { name: "Alexander Hwang", ticker: "ALEX", basePrice: 10, volatility: 0.035, dateAdded: "2026-01-16T00:33:00" },
  { name: "Taejin Cheon", ticker: "SHMN", basePrice: 65, volatility: 0.035, dateAdded: "2026-01-16T00:34:00" },
  { name: "Hangyeol Baek", ticker: "NO1", basePrice: 35, volatility: 0.035, dateAdded: "2026-01-16T00:35:00" },
  { name: "Luah Lim", ticker: "LUAH", basePrice: 20, volatility: 0.03, dateAdded: "2026-01-16T00:36:00" },
  { name: "Old Face", ticker: "OLDF", basePrice: 10, volatility: 0.04, dateAdded: "2026-01-16T00:37:00" },
  { name: "Max Kang", ticker: "MAX", basePrice: 15, volatility: 0.035, dateAdded: "2026-01-16T00:38:00" },
  { name: "Derrick Jo", ticker: "DJO", basePrice: 15, volatility: 0.035, dateAdded: "2026-01-16T00:39:00" },
  { name: "Yenna Jang", ticker: "ZAMI", basePrice: 10, volatility: 0.03, dateAdded: "2026-01-16T00:40:00" },
  { name: "Ryan the Cat", ticker: "RYAN", basePrice: 10, volatility: 0.03, dateAdded: "2026-01-16T00:41:00" },
  { name: "Sanghui Han", ticker: "SGUI", basePrice: 10, volatility: 0.035, dateAdded: "2026-01-16T00:42:00" },
  { name: "Yeongcheol Kim", ticker: "YCHL", basePrice: 10, volatility: 0.035, dateAdded: "2026-01-16T00:43:00" },
  { name: "Sera Shin", ticker: "SERA", basePrice: 20, volatility: 0.03, dateAdded: "2026-01-16T00:44:00" },

  // New characters added 2026-01-24
  { name: "Somi Park", ticker: "SOMI", basePrice: 15, volatility: 0.035, dateAdded: "2026-01-24T00:00:00" },
  { name: "Gwang Yu", ticker: "MMA", basePrice: 17.50, volatility: 0.035, dateAdded: "2026-01-24T00:01:00" },
  { name: "Beolgu Lee", ticker: "LIAR", basePrice: 15, volatility: 0.035, dateAdded: "2026-01-24T00:02:00" },
  { name: "Jaesu Noh", ticker: "NOH", basePrice: 13, volatility: 0.035, dateAdded: "2026-01-24T00:03:00" },
  { name: "Gyeol Baek", ticker: "DOC", basePrice: 12.50, volatility: 0.035, dateAdded: "2026-01-24T00:04:00" },
  { name: "Sujin Kim", ticker: "SUJN", basePrice: 15, volatility: 0.03, dateAdded: "2026-01-24T00:05:00" },
  { name: "Byeon Kim", ticker: "LAW", basePrice: 30, volatility: 0.035, dateAdded: "2026-01-24T00:06:00" },
  { name: "Jihan Kwak", ticker: "CHCH", basePrice: 30, volatility: 0.035, dateAdded: "2026-01-24T00:07:00" },
  { name: "Jibeom Kwak", ticker: "BEOM", basePrice: 15, volatility: 0.035, dateAdded: "2026-01-24T00:08:00" },

  // New characters added 2026-01-26
  { name: "Brekdak", ticker: "MUAY", basePrice: 70, volatility: 0.035, dateAdded: "2026-01-26T00:00:00" },

  // IPO characters - require IPO process before trading
  { name: "Ryu Baekgeon", ticker: "RYU", basePrice: 55, volatility: 0.04, dateAdded: "2026-02-12T00:00:00", ipoRequired: true },

  // ETFs - crew-based funds (price = sum of member base prices / 5)
  {
    name: "Allied Fund", ticker: "ALLY", basePrice: 78, volatility: 0.025, dateAdded: "2026-02-20T00:00:00",
    isETF: true, description: "Allied crew ETF",
    constituents: ["BDNL", "LDNL", "VSCO", "ZACK", "JAY", "VIN", "AHN"],
    trailingFactors: [
      { ticker: "BDNL", coefficient: 0.114 }, { ticker: "LDNL", coefficient: 0.114 },
      { ticker: "VSCO", coefficient: 0.114 }, { ticker: "ZACK", coefficient: 0.114 },
      { ticker: "JAY", coefficient: 0.114 }, { ticker: "VIN", coefficient: 0.114 },
      { ticker: "AHN", coefficient: 0.114 }
    ]
  },
  {
    name: "Big Deal Fund", ticker: "DEAL", basePrice: 46, volatility: 0.025, dateAdded: "2026-02-20T00:01:00",
    isETF: true, description: "Big Deal crew ETF",
    constituents: ["JAKE", "SWRD", "JSN", "BRAD", "LINE", "SINU", "LUAH"],
    trailingFactors: [
      { ticker: "JAKE", coefficient: 0.114 }, { ticker: "SWRD", coefficient: 0.114 },
      { ticker: "JSN", coefficient: 0.114 }, { ticker: "BRAD", coefficient: 0.114 },
      { ticker: "LINE", coefficient: 0.114 }, { ticker: "SINU", coefficient: 0.114 },
      { ticker: "LUAH", coefficient: 0.114 }
    ]
  },
  {
    name: "Fist Gang Fund", ticker: "FIST", basePrice: 100.5, volatility: 0.025, dateAdded: "2026-02-20T00:02:00",
    isETF: true, description: "Fist Gang crew ETF",
    constituents: ["GAP", "ELIT", "JYNG", "TOM", "KWON", "DNCE", "GNTL", "MMA", "LIAR", "NOH"],
    trailingFactors: [
      { ticker: "GAP", coefficient: 0.08 }, { ticker: "ELIT", coefficient: 0.08 },
      { ticker: "JYNG", coefficient: 0.08 }, { ticker: "TOM", coefficient: 0.08 },
      { ticker: "KWON", coefficient: 0.08 }, { ticker: "DNCE", coefficient: 0.08 },
      { ticker: "GNTL", coefficient: 0.08 }, { ticker: "MMA", coefficient: 0.08 },
      { ticker: "LIAR", coefficient: 0.08 }, { ticker: "NOH", coefficient: 0.08 }
    ]
  },
  {
    name: "Secret Friends Fund", ticker: "SCRT", basePrice: 50, volatility: 0.025, dateAdded: "2026-02-20T00:03:00",
    isETF: true, description: "Secret Friends crew ETF",
    constituents: ["GOO", "LOGN", "SAM", "ALEX", "SHMN"],
    trailingFactors: [
      { ticker: "GOO", coefficient: 0.16 }, { ticker: "LOGN", coefficient: 0.16 },
      { ticker: "SAM", coefficient: 0.16 }, { ticker: "ALEX", coefficient: 0.16 },
      { ticker: "SHMN", coefficient: 0.16 }
    ]
  },
  {
    name: "Hostel Fund", ticker: "HSTL", basePrice: 34.2, volatility: 0.025, dateAdded: "2026-02-20T00:04:00",
    isETF: true, description: "Hostel crew ETF",
    constituents: ["ELI", "SLLY", "CHAE", "MAX", "DJO", "ZAMI", "RYAN"],
    trailingFactors: [
      { ticker: "ELI", coefficient: 0.114 }, { ticker: "SLLY", coefficient: 0.114 },
      { ticker: "CHAE", coefficient: 0.114 }, { ticker: "MAX", coefficient: 0.114 },
      { ticker: "DJO", coefficient: 0.114 }, { ticker: "ZAMI", coefficient: 0.114 },
      { ticker: "RYAN", coefficient: 0.114 }
    ]
  },
  {
    name: "WTJC Fund", ticker: "WTJC", basePrice: 47.5, volatility: 0.025, dateAdded: "2026-02-20T00:05:00",
    isETF: true, description: "WTJC crew ETF",
    constituents: ["TOM", "SRMK", "SGUI", "YCHL", "SERA", "MMA", "LIAR", "NOH"],
    trailingFactors: [
      { ticker: "TOM", coefficient: 0.10 }, { ticker: "SRMK", coefficient: 0.10 },
      { ticker: "SGUI", coefficient: 0.10 }, { ticker: "YCHL", coefficient: 0.10 },
      { ticker: "SERA", coefficient: 0.10 }, { ticker: "MMA", coefficient: 0.10 },
      { ticker: "LIAR", coefficient: 0.10 }, { ticker: "NOH", coefficient: 0.10 }
    ]
  },
  {
    name: "Workers Fund", ticker: "VVIP", basePrice: 94.1, volatility: 0.025, dateAdded: "2026-02-20T00:06:00",
    isETF: true, description: "Workers crew ETF",
    constituents: ["WRKR", "BANG", "CAPG", "JYNG", "NOMN", "NEKO", "DOOR", "JINJ", "DRMA", "HYOT", "OLDF", "SHKO", "HIKO", "DOC", "NO1"],
    trailingFactors: [
      { ticker: "WRKR", coefficient: 0.053 }, { ticker: "BANG", coefficient: 0.053 },
      { ticker: "CAPG", coefficient: 0.053 }, { ticker: "JYNG", coefficient: 0.053 },
      { ticker: "NOMN", coefficient: 0.053 }, { ticker: "NEKO", coefficient: 0.053 },
      { ticker: "DOOR", coefficient: 0.053 }, { ticker: "JINJ", coefficient: 0.053 },
      { ticker: "DRMA", coefficient: 0.053 }, { ticker: "HYOT", coefficient: 0.053 },
      { ticker: "OLDF", coefficient: 0.053 }, { ticker: "SHKO", coefficient: 0.053 },
      { ticker: "HIKO", coefficient: 0.053 }, { ticker: "DOC", coefficient: 0.053 },
      { ticker: "NO1", coefficient: 0.053 }
    ]
  },
  {
    name: "Yamazaki Fund", ticker: "YAMA", basePrice: 68, volatility: 0.025, dateAdded: "2026-02-20T00:07:00",
    isETF: true, description: "Yamazaki crew ETF",
    constituents: ["GUN", "SHNG", "SHRO", "SHKO", "HIKO", "SOMI"],
    trailingFactors: [
      { ticker: "GUN", coefficient: 0.133 }, { ticker: "SHNG", coefficient: 0.133 },
      { ticker: "SHRO", coefficient: 0.133 }, { ticker: "SHKO", coefficient: 0.133 },
      { ticker: "HIKO", coefficient: 0.133 }, { ticker: "SOMI", coefficient: 0.133 }
    ]
  },
  {
    name: "J High School ETF", ticker: "JWON", basePrice: 115.20, volatility: 0.025, dateAdded: "2026-02-20T00:08:00",
    isETF: true, description: "J High School ETF",
    constituents: ["BDNL", "LDNL", "ELI", "ZACK", "VSCO", "VIN", "JAY", "LOGN", "2SEC", "CRYS", "DUKE", "DOO", "JACE", "MIRA", "ZOE", "JOY", "JIHO"],
    trailingFactors: [
      { ticker: "BDNL", coefficient: 0.047 }, { ticker: "LDNL", coefficient: 0.047 },
      { ticker: "ELI", coefficient: 0.047 }, { ticker: "ZACK", coefficient: 0.047 },
      { ticker: "VSCO", coefficient: 0.047 }, { ticker: "VIN", coefficient: 0.047 },
      { ticker: "JAY", coefficient: 0.047 }, { ticker: "LOGN", coefficient: 0.047 },
      { ticker: "2SEC", coefficient: 0.047 }, { ticker: "CRYS", coefficient: 0.047 },
      { ticker: "DUKE", coefficient: 0.047 }, { ticker: "DOO", coefficient: 0.047 },
      { ticker: "JACE", coefficient: 0.047 }, { ticker: "MIRA", coefficient: 0.047 },
      { ticker: "ZOE", coefficient: 0.047 }, { ticker: "JOY", coefficient: 0.047 },
      { ticker: "JIHO", coefficient: 0.047 }
    ]
  },
  {
    name: "Kitae Kim Alliance ETF", ticker: "SHDW", basePrice: 155, volatility: 0.025, dateAdded: "2026-02-20T00:09:00",
    isETF: true, description: "Kitae Kim Alliance ETF",
    constituents: ["KTAE", "DG", "GNTL", "GOO", "SAM", "SHMN", "SAMC", "YONG", "PAJU", "PHNG", "CROW", "COP", "RYU"],
    trailingFactors: [
      { ticker: "KTAE", coefficient: 0.062 }, { ticker: "DG", coefficient: 0.062 },
      { ticker: "GNTL", coefficient: 0.062 }, { ticker: "GOO", coefficient: 0.062 },
      { ticker: "SAM", coefficient: 0.062 }, { ticker: "SHMN", coefficient: 0.062 },
      { ticker: "SAMC", coefficient: 0.062 }, { ticker: "YONG", coefficient: 0.062 },
      { ticker: "PAJU", coefficient: 0.062 }, { ticker: "PHNG", coefficient: 0.062 },
      { ticker: "CROW", coefficient: 0.062 }, { ticker: "COP", coefficient: 0.062 },
      { ticker: "RYU", coefficient: 0.062 }
    ]
  },
  {
    name: "Jake Kim Alliance ETF", ticker: "JKAL", basePrice: 137.40, volatility: 0.025, dateAdded: "2026-02-20T00:10:00",
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
