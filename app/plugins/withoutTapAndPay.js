const { withProjectBuildGradle } = require('expo/config-plugins');

const MARK = '// without tap and pay';
const LINES = `
${MARK}: Stripe's optional card provisioning needs a library that is on no public repository.
// We do not use it, and only the release lint check asks for it.
subprojects {
  configurations.configureEach {
    exclude group: 'com.google.android.gms', module: 'play-services-tapandpay'
  }
}
`;

module.exports = (config) =>
  withProjectBuildGradle(config, (project) => {
    if (!project.modResults.contents.includes(MARK)) project.modResults.contents += LINES;
    return project;
  });
