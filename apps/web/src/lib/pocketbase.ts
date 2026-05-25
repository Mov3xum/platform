import PocketBase from 'pocketbase';
import { getPublicPbUrl } from '@/lib/pb-url';

export const pb = new PocketBase(getPublicPbUrl());

export const getClientAuth = () => pb.authStore.model;

export const loginWithPassword = async (email: string, password: string) =>
  pb.collection('users').authWithPassword(email, password);

export const logout = () => pb.authStore.clear();
