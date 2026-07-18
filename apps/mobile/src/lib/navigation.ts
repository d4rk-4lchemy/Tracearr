import { useNavigation } from 'expo-router';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import type { ParamListBase } from '@react-navigation/native';

export type AppNavigation = DrawerNavigationProp<ParamListBase>;

export function useAppNavigation() {
  return useNavigation<AppNavigation>();
}
