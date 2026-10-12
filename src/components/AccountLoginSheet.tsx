import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { CheckCircle2, ChevronLeft, KeyRound, RotateCcw, ShieldCheck, XCircle } from 'lucide-react-native';
import { Colors, PROVIDER_NAMES, Radius } from '../constants/theme';
import { AccountCredentials, AccountEntity, ProviderType } from '../models/types';
import { parseManualInput } from '../services/curlParser';
import { buildChatGPTAuthorizeUrl, exchangeChatGPTCode, isChatGPTCallbackUrl } from '../services/oauth/chatgptOAuth';
import { buildClaudeAuthorizeUrl, exchangeClaudeCode, isClaudeCallbackUrl } from '../services/oauth/claudeOAuth';
import { parseAuthCode } from '../services/oauth/authCode';
import { createPkcePair, PkcePair } from '../services/oauth/pkce';
import { useAppStore } from '../store/useAppStore';
import { ProviderLogo } from './ProviderLogo';
import { PrimaryButton, Segmented } from './ui';

// Google blocks sign-in inside embedded browsers with the default WebView UA
const SAFARI_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

type Phase = 'login' | 'exchanging' | 'success' | 'error';
type Mode = 'oauth' | 'manual';

interface Props {
  visible: boolean;
  providerType: ProviderType;
  /** When set, the login re-binds this account instead of creating a new one. */
  account?: AccountEntity | null;
  onClose: () => void;
  onConnected?: (accountId: string) => void;
}

const supportsOAuth = (p: ProviderType) => p === 'claude' || p === 'chatgpt';

const MANUAL_HINTS: Partial<Record<ProviderType, string>> = {
  claude:
    'Откройте claude.ai в браузере на компьютере → DevTools → Application → Cookies → скопируйте значение sessionKey. Или Network → любой запрос к /api → Copy as cURL.',
  chatgpt:
    'Откройте chatgpt.com/api/auth/session в браузере и скопируйте accessToken, либо Network → запрос к backend-api → Copy as cURL.',
  gemini:
    'Откройте gemini.google.com на компьютере → DevTools → Network → любой запрос batchexecute → Copy as cURL. Для каждого Google-аккаунта нужен свой cURL (из отдельного профиля браузера).',
  cursor:
    'Откройте cursor.com/settings → DevTools → Network → запрос usage → Copy as cURL.',
  copilot:
    'Откройте github.com (с активным Copilot) → DevTools → Network → Copy as cURL запроса к Copilot, либо вставьте токен.',
  perplexity:
    'Откройте perplexity.ai → DevTools → Network → запрос к rest/user → Copy as cURL.',
  grok:
    'Откройте grok.com → DevTools → Network → запрос rate-limits → Copy as cURL.',
  mistral: 'Откройте chat.mistral.ai → DevTools → Network → Copy as cURL запроса с вашими лимитами.',
  deepseek: 'Откройте chat.deepseek.com → DevTools → Network → Copy as cURL запроса профиля/лимитов.',
  poe: 'Откройте poe.com → DevTools → Network → запрос gql_POST (settings) → Copy as cURL.',
  custom:
    'Вставьте cURL запроса, который на сайте сервиса возвращает ваши лимиты (DevTools → Network → Copy as cURL). Приложение само найдёт в ответе проценты и время сброса.',
};
const DEFAULT_HINT = 'Вставьте cURL запроса сервиса, который возвращает ваши лимиты.';

export const AccountLoginSheet: React.FC<Props> = ({ visible, providerType, account, onClose, onConnected }) => {
  const connectAccount = useAppStore((s) => s.connectAccount);
  const [mode, setMode] = useState<Mode>(supportsOAuth(providerType) ? 'oauth' : 'manual');
  const [phase, setPhase] = useState<Phase>('login');
  const [message, setMessage] = useState<string>('');
  const [pkce, setPkce] = useState<PkcePair | null>(null);
  const [webKey, setWebKey] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [manualText, setManualText] = useState('');
  const [codeText, setCodeText] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(false);
  const handledRef = useRef(false);

  const reset = useCallback(async () => {
    handledRef.current = false;
    setPhase('login');
    setMessage('');
    setCodeText('');
    setShowCodeInput(Platform.OS === 'web');
    setPageLoading(true);
    if (supportsOAuth(providerType)) {
      setPkce(await createPkcePair());
      setWebKey((k) => k + 1);
    }
  }, [providerType]);

  useEffect(() => {
    if (visible) {
      setMode(supportsOAuth(providerType) ? 'oauth' : 'manual');
      setManualText('');
      reset();
    }
  }, [visible, providerType, reset]);

  const authorizeUrl = pkce
    ? providerType === 'claude'
      ? buildClaudeAuthorizeUrl(pkce.challenge, pkce.state)
      : buildChatGPTAuthorizeUrl(pkce.challenge, pkce.state)
    : null;

  const finish = async (creds: AccountCredentials) => {
    const result = await connectAccount(providerType, creds, account?.id);
    if (!result.ok) {
      setPhase('error');
      setMessage(result.error);
      return;
    }
    setPhase('success');
    const who = result.snapshot.email ? ` (${result.snapshot.email})` : '';
    setMessage(`Аккаунт подключён${who}`);
    setTimeout(() => {
      onConnected?.(result.accountId);
      onClose();
    }, 900);
  };

  const handleAuthCode = async (raw: string) => {
    if (!pkce || handledRef.current) return;
    const parsed = parseAuthCode(raw);
    if (!parsed) {
      setPhase('error');
      setMessage('Не удалось прочитать код авторизации');
      return;
    }
    if (parsed.state && parsed.state !== pkce.state) {
      setPhase('error');
      setMessage('Код относится к другой попытке входа. Начните заново.');
      return;
    }
    handledRef.current = true;
    setPhase('exchanging');
    setMessage('Получаем токены…');
    try {
      const creds =
        providerType === 'claude'
          ? await exchangeClaudeCode(parsed.code, parsed.state, pkce.verifier, pkce.state)
          : await exchangeChatGPTCode(parsed.code, pkce.verifier);
      setMessage('Проверяем аккаунт и загружаем лимиты…');
      await finish(creds);
    } catch (e: any) {
      setPhase('error');
      setMessage(e?.message || 'Не удалось завершить вход');
    }
  };

  const isCallback = (url: string) =>
    providerType === 'claude' ? isClaudeCallbackUrl(url) : isChatGPTCallbackUrl(url);

  const handleManualSave = async () => {
    const parsed = parseManualInput(manualText, providerType);
    if (!parsed.ok) {
      setPhase('error');
      setMessage(parsed.error);
      return;
    }
    setPhase('exchanging');
    setMessage('Проверяем данные и загружаем лимиты…');
    await finish(parsed.credentials);
  };

  const title = account ? `Переподключить: ${account.name}` : `Вход в ${PROVIDER_NAMES[providerType]}`;

  const renderStatus = () => {
    if (phase === 'login' || !message) return null;
    const color =
      phase === 'error' ? Colors.exhausted : phase === 'success' ? Colors.normal : Colors.textMuted;
    return (
      <View style={[styles.statusBar, { borderColor: color }]}>
        {phase === 'exchanging' && <ActivityIndicator size="small" color={color} />}
        {phase === 'success' && <CheckCircle2 size={16} color={color} />}
        {phase === 'error' && <XCircle size={16} color={color} />}
        <Text style={[styles.statusText, { color }]}>{message}</Text>
        {phase === 'error' && (
          <TouchableOpacity onPress={reset} style={styles.retryBtn}>
            <RotateCcw size={13} color={Colors.text} />
            <Text style={styles.retryText}>Заново</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderOAuth = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.tip}>
        <ShieldCheck size={15} color={Colors.normal} />
        <Text style={styles.tipText}>
          Чистая сессия: войдите в {account ? 'нужный' : 'любой'} аккаунт {PROVIDER_NAMES[providerType]}. Другие
          подключённые аккаунты не затрагиваются.
          {providerType === 'claude' ? ' После входа нажмите «Authorize».' : ''}
        </Text>
      </View>

      {showCodeInput && (
        <View style={styles.codeBox}>
          {Platform.OS === 'web' && authorizeUrl && (
            <PrimaryButton
              label="Открыть страницу входа"
              onPress={() => Linking.openURL(authorizeUrl)}
              style={{ marginBottom: 10 }}
            />
          )}
          <Text style={styles.codeLabel}>
            {providerType === 'claude'
              ? 'Если страница показала код — вставьте его сюда:'
              : 'Вставьте адрес страницы, на которую вас перенаправило (localhost:1455/…):'}
          </Text>
          <View style={styles.codeRow}>
            <TextInput
              style={styles.codeInput}
              value={codeText}
              onChangeText={setCodeText}
              placeholder={providerType === 'claude' ? 'code#state' : 'http://localhost:1455/auth/callback?code=…'}
              placeholderTextColor={Colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.codeBtn} onPress={() => handleAuthCode(codeText)}>
              <Text style={styles.codeBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {Platform.OS !== 'web' && authorizeUrl && (
        <View style={styles.webWrap}>
          <WebView
            key={webKey}
            source={{ uri: authorizeUrl }}
            incognito
            cacheEnabled={false}
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically
            userAgent={SAFARI_USER_AGENT}
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={(req) => {
              if (isCallback(req.url)) {
                handleAuthCode(req.url);
                return false;
              }
              return /^https?:/i.test(req.url);
            }}
            onNavigationStateChange={(nav: WebViewNavigation) => {
              setPageLoading(nav.loading);
              if (isCallback(nav.url)) handleAuthCode(nav.url);
            }}
            onLoadEnd={() => setPageLoading(false)}
            onError={(e) => {
              const url = e.nativeEvent.url || '';
              if (isCallback(url)) handleAuthCode(url);
            }}
            style={styles.webview}
          />
          {(pageLoading || phase === 'exchanging') && (
            <View style={styles.loader} pointerEvents="none">
              <ActivityIndicator size="large" color={Colors.text} />
            </View>
          )}
        </View>
      )}

      {!showCodeInput && Platform.OS !== 'web' && (
        <TouchableOpacity style={styles.linkBtn} onPress={() => setShowCodeInput(true)}>
          <KeyRound size={13} color={Colors.textMuted} />
          <Text style={styles.linkText}>Страница показала код? Вставить вручную</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderManual = () => (
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
      <View style={styles.manualHead}>
        <ProviderLogo type={providerType} size={44} />
        <Text style={styles.manualHint}>{MANUAL_HINTS[providerType] || DEFAULT_HINT}</Text>
      </View>
      <TextInput
        style={styles.manualInput}
        value={manualText}
        onChangeText={setManualText}
        placeholder={
          providerType === 'claude'
            ? 'sk-ant-sid01-… или curl …'
            : providerType === 'chatgpt'
            ? 'eyJhbGciOi… или curl …'
            : "curl 'https://gemini.google.com/_/BardChatUi/…"
        }
        placeholderTextColor={Colors.textSubtle}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical="top"
      />
      <Text style={styles.manualNote}>
        Данные хранятся только на этом устройстве (Keychain / Keystore) и отправляются лишь на серверы{' '}
        {PROVIDER_NAMES[providerType]}.
      </Text>
      <PrimaryButton
        label="Подключить"
        onPress={handleManualSave}
        disabled={!manualText.trim() || phase === 'exchanging'}
      />
    </ScrollView>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <ChevronLeft size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
          </View>

          {supportsOAuth(providerType) && (
            <Segmented
              style={{ marginHorizontal: 16, marginBottom: 10 }}
              value={mode}
              onChange={(m) => {
                setMode(m);
                setPhase('login');
                setMessage('');
              }}
              options={[
                { key: 'oauth', label: 'Вход в аккаунт' },
                { key: 'manual', label: 'Вручную (cURL / токен)' },
              ]}
            />
          )}

          {renderStatus()}

          <View style={{ flex: 1, paddingHorizontal: mode === 'manual' ? 16 : 0 }}>
            {mode === 'oauth' && supportsOAuth(providerType) ? renderOAuth() : renderManual()}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  tip: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.normalSoft,
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#166534',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    backgroundColor: Colors.card,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.cardHighlight,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text,
  },
  webWrap: {
    flex: 1,
    marginHorizontal: 12,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#fff',
  },
  webview: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loader: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  linkText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  codeBox: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  codeLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 6,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  codeInput: {
    flex: 1,
    backgroundColor: Colors.cardElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: Colors.text,
  },
  codeBtn: {
    backgroundColor: Colors.ink,
    borderRadius: Radius.sm,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  codeBtnText: {
    color: Colors.inkText,
    fontWeight: '700',
  },
  manualHead: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    marginVertical: 12,
  },
  manualHint: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.textMuted,
  },
  manualInput: {
    minHeight: 160,
    backgroundColor: Colors.cardElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: 14,
    fontSize: 12.5,
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  manualNote: {
    fontSize: 11.5,
    color: Colors.textSubtle,
    lineHeight: 16,
    marginVertical: 12,
  },
});
