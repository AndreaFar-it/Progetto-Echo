import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:   'com.echo.app',
  appName: 'ECHO',
  webDir:  'www',
  server: {
    // Uncomment and set your LAN IP for live-reload on a physical device:
    // url: 'http://192.168.x.x:4200',
    cleartext: true,
    androidScheme: 'http',
  },
  plugins: {
    Camera: { androidPermissions: ['android.permission.CAMERA'] },
    PushNotifications: { presentationOptions: ['badge','sound','alert'] },
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#F6EFE8',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
};

export default config;
