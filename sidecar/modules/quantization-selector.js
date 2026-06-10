function getSelectedModel(profile) {
  const ceilingGB = profile.availableRamBytes / 1073741824;
  
  if (ceilingGB < 3.5) {
    return { model: 'NONE', tier: 'CONSTRAINED' };
  }
  if (ceilingGB < 5.5) return { model: 'qwen2.5:1.5b', tier: 'FLOOR' };
  if (ceilingGB < 9.5) return { model: 'qwen2.5:3b', tier: 'STANDARD' };
  if (ceilingGB < 17)  return { model: 'mistral:7b', tier: 'PERFORMANCE' };
  return { model: 'qwen2.5:32b', tier: 'MAXIMUM' };
}

module.exports = { getSelectedModel };
