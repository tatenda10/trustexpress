import { createNavigationContainerRef } from '@react-navigation/native';

/** Root ref so screens can dispatch after nested stacks remount (e.g. driver `key={initialRoute}`). */
export const navigationRef = createNavigationContainerRef();
