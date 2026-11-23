// Extends app.json. The Google sign-in config plugin (used for Google Drive backup) only does iOS setup and fails
// without an iOS URL scheme, so it is added only once google-oauth.json has the iOS client's values.
const googleOAuth = require('./google-oauth.json');

module.exports = ({ config }) => {
  const plugins = (config.plugins ?? []).filter((plugin) => plugin !== '@react-native-google-signin/google-signin');
  if (googleOAuth.iosUrlScheme) {
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: googleOAuth.iosUrlScheme }]);
  }
  return { ...config, plugins };
};
