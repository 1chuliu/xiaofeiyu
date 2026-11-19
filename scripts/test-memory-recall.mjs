/** 记忆召回：相关行挑选 / 回退 / 条数上限 回归测试（离线） */
const BUNDLE = new URL('../.tmp/adapter/bundle.mjs', import.meta.url).href
const memory = new Map()
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
  key: (index) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size
  },
}

const { splitMemoryLines, scoreMemoryLine, recallMemory, textVector, cosineSimilarity } =
  await import(BUNDLE)

const autoMemory = [
  '- 沈舟左手腕有旧疤，是十年前救人留下的。',
  '- 梅雨季那把旧伞是林晚送的，沈舟一直留着。',
  '- 林晚在城东出版社做编辑，在跟一本悬疑小说。',
  '- 两人还没说破彼此的心意。',
  '- 沈舟的猫叫“豆浆”，怕生。',
].join('\n')

const lines = splitMemoryLines(autoMemory)
const recallUmbrella = recallMemory(autoMemory, '今天又下雨了，你的那把伞还在吗？')
const recallCat = recallMemory(autoMemory, '豆浆今天躲床底下了')
const limitTwo = recallMemory(autoMemory, '沈舟的伞和出版社，还有豆浆', { maxLines: 2 })
const noMatch = recallMemory(autoMemory, '外面阳光很好', { fallbackLines: 3 })
const empty = recallMemory('', '随便问问')

// 向量模式
const umbrellaVector = recallMemory(autoMemory, '今天又下雨了，你的那把伞还在吗？', { mode: 'vector' })
const catVector = recallMemory(autoMemory, '豆浆今天躲床底下了', { mode: 'vector' })
const selfSim = cosineSimilarity(textVector('旧伞'), textVector('旧伞'))
const zeroSim = cosineSimilarity(textVector('旧伞'), textVector('完全无关'))

const checks = {
  '按行拆分去掉项目符号': lines.length === 5 && !lines[0].startsWith('-'),
  '伞相关行被召回': recallUmbrella.includes('旧伞') && !recallUmbrella.includes('豆浆'),
  '猫相关行被召回': recallCat.includes('豆浆'),
  '条数上限生效': limitTwo.split('\n').length === 2,
  '无命中回退最后几条': noMatch.split('\n').length === 3 && noMatch.includes('豆浆'),
  '空记忆不注入': empty === '',
  '打分：命中越多分越高': scoreMemoryLine('沈舟的伞和猫', '沈舟的伞和猫') > scoreMemoryLine('沈舟的伞和猫', '伞'),
  '向量：伞相关行召回': umbrellaVector.includes('旧伞') && !umbrellaVector.includes('豆浆'),
  '向量：猫相关行召回': catVector.includes('豆浆'),
  '余弦：自相似为 1': Math.abs(selfSim - 1) < 1e-9,
  '余弦：无关为 0': zeroSim === 0,
}

let failed = 0
for (const [name, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
  if (!ok) failed += 1
}
console.log(`\n“下雨”召回：\n${recallUmbrella}`)
console.log(`\n无命中回退：\n${noMatch}`)
process.exitCode = failed ? 1 : 0