const os = require('os');
const { execSync } = require('child_process');

function getHardwareProfile() {
  const platform = process.platform;
  const totalMem = os.totalmem();
  let availableRam = os.freemem(); // Baseline
  let appleChip = null;
  let unifiedMemory = false;

  if (platform === 'darwin') {
    const brand = execSync('sysctl -n machdep.cpu.brand_string').toString();
    appleChip = brand.includes('Apple') ? brand.split(' ')[0] : 'Intel';
    unifiedMemory = appleChip !== 'Intel';
  }

  // Safety margin: never allocate more than 70% of available RAM
  const allocationCeiling = Math.floor(availableRam * 0.70);

  return {
    platform,
    availableRamBytes: availableRam,
    allocationCeilingBytes: allocationCeiling,
    cpuCores: os.cpus().length,
    gpuVramBytes: null,
    appleChip,
    unifiedMemory,
    timestamp: new Date().toISOString(),
    profileVersion: '1.1'
  };
}

module.exports = { getHardwareProfile };
