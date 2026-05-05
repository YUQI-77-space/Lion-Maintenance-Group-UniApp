/**
 * 敏感词过滤工具
 * 用于过滤昵称、评论等用户输入内容中的敏感词
 */

// 敏感词词库 - 可根据需要扩展
const SENSITIVE_WORDS = [
  // 淫秽色情类
  '色情', '黄色', '淫秽', '淫荡', '性交', '做爱', '激情', '裸体', '裸照', '脱衣', '内裤', '胸罩',
  '性感', '诱惑', '调情', '春药', '援交', '嫖娼', '卖淫', '妓女', '鸡头', '皮条客',
  
  // 政治敏感类
  '法轮功', '大法', '轮子功', '李洪志', '真善忍', '九评', '退党', '藏独', '疆独', '台独',
  '达赖', '班禅', '喇嘛', '活佛', '转世', '政变', '民运', '反政府', '颠覆',
  
  // 暴力恐怖类
  '杀死', '杀害', '杀人', '谋杀', '暗杀', '刺杀', '屠杀', '血腥', '残忍', '暴力',
  '恐怖', '爆炸', '炸弹', '炸药', '枪支', '子弹', '手榴弹', '自杀', '跳楼', '割腕',
  
  // 种族歧视类
  '黑鬼', '白猪', '黄猴', '日本鬼子', '小日本', '棒子', '阿三', '鬼佬', '老外',
  
  // 侮辱谩骂类
  '傻逼', '操你', '草你', '日你', '滚蛋', '滚开', '去死', '死全家', '妈逼', '婊子',
  '贱人', '垃圾', '废物', '白痴', '弱智', '脑残', '智障', '猪脑', '狗屎', '屁话',
  '放屁', '扯淡', '胡说', '瞎说', '混蛋', '王八蛋', '龟儿子', '狗娘养', '畜生',
  
  // 宗教极端类
  '邪教', '异端', '魔教', '撒旦', '魔鬼', '地狱', '诅咒', '下地狱',
  
  // 赌博诈骗类
  '赌博', '赌场', '老虎机', '百家乐', '21点', '梭哈', '炸金花', '斗地主', '麻将',
  '诈骗', '骗钱', '传销', '非法集资', '高利贷', '洗钱', '黑钱',
  
  // 毒品相关类
  '吸毒', '毒品', '海洛因', '可卡因', '大麻', '冰毒', '摇头丸', '鸦片', '吗啡',
  
  // 其他不当内容
  '管理员', '系统', '官方', '客服', '机器人', 'admin', 'system', 'robot', 'bot'
];

// 将敏感词转换为正则表达式模式
const createSensitiveWordRegex = () => {
  // 转义特殊字符并用 | 连接
  const escapedWords = SENSITIVE_WORDS.map(word => 
    word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  return new RegExp(`(${escapedWords.join('|')})`, 'gi');
};

const SENSITIVE_WORD_REGEX = createSensitiveWordRegex();

/**
 * 检查文本是否包含敏感词
 * @param {string} text - 待检查的文本
 * @returns {boolean} - 是否包含敏感词
 */
const containsSensitiveWord = (text) => {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  // 移除空格和特殊字符后检查
  const cleanText = text.replace(/[\s\-_\.]/g, '');
  return SENSITIVE_WORD_REGEX.test(cleanText);
};

/**
 * 获取文本中的敏感词列表
 * @param {string} text - 待检查的文本
 * @returns {Array} - 敏感词数组
 */
const getSensitiveWords = (text) => {
  if (!text || typeof text !== 'string') {
    return [];
  }
  
  const cleanText = text.replace(/[\s\-_\.]/g, '');
  const matches = cleanText.match(SENSITIVE_WORD_REGEX);
  return matches ? [...new Set(matches)] : [];
};

/**
 * 过滤敏感词，用*替换
 * @param {string} text - 待过滤的文本
 * @returns {string} - 过滤后的文本
 */
const filterSensitiveWords = (text) => {
  if (!text || typeof text !== 'string') {
    return text;
  }
  
  let filteredText = text;
  SENSITIVE_WORDS.forEach(word => {
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    filteredText = filteredText.replace(regex, '*'.repeat(word.length));
  });
  
  return filteredText;
};

/**
 * 验证昵称是否合法
 * @param {string} nickname - 昵称
 * @returns {Object} - 验证结果 {valid: boolean, message: string}
 */
const validateNickname = (nickname) => {
  if (!nickname) {
    return {
      valid: false,
      message: '昵称不能为空'
    };
  }
  
  if (typeof nickname !== 'string') {
    return {
      valid: false,
      message: '昵称格式不正确'
    };
  }
  
  // 长度检查
  if (nickname.length < 1 || nickname.length > 20) {
    return {
      valid: false,
      message: '昵称长度应在1-20个字符之间'
    };
  }
  
  // 敏感词检查
  if (containsSensitiveWord(nickname)) {
    const sensitiveWords = getSensitiveWords(nickname);
    return {
      valid: false,
      message: `昵称包含不当内容：${sensitiveWords.join('、')}，请修改后重试`
    };
  }
  
  // 特殊字符检查 - 只允许中文、英文、数字、常用符号
  const validCharsRegex = /^[\u4e00-\u9fa5a-zA-Z0-9\-_\.\s]+$/;
  if (!validCharsRegex.test(nickname)) {
    return {
      valid: false,
      message: '昵称只能包含中文、英文、数字和常用符号（-_.）'
    };
  }
  
  return {
    valid: true,
    message: '昵称验证通过'
  };
};

module.exports = {
  containsSensitiveWord,
  getSensitiveWords,
  filterSensitiveWords,
  validateNickname,
  SENSITIVE_WORDS
};
