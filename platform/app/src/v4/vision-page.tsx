import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, C, F } from '../design';
import { desk } from './api';
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.paper },
  wrap: {
    width: '100%',
    maxWidth: 650,
    alignSelf: 'center',
    padding: 21,
    paddingBottom: 60,
    gap: 12,
  },
  title: { fontFamily: F.serif, fontSize: 38, lineHeight: 42, color: C.ink },
  section: { paddingVertical: 12, borderTopWidth: 1, borderColor: C.line },
  head: { fontFamily: F.serif, fontSize: 25, color: C.ink },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 22, color: C.ink, paddingVertical: 5 },
  cell: { paddingVertical: 6, borderBottomWidth: 1, borderColor: C.line },
  label: { fontFamily: F.medium, fontSize: 13, color: C.forest },
});
const plain = (v: string) =>
  v
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|\x60/g, '')
    .trim();
function sections(markdown: string) {
  const result: { title: string; lines: string[] }[] = [];
  let title = 'Complete vision';
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^\|[\s:|-]+\|$/.test(line)) continue;
    if (line.startsWith('# ')) {
      title = plain(line.slice(2));
      continue;
    }
    if (line.startsWith('## ')) {
      result.push({ title: plain(line.slice(3)), lines: [] });
      continue;
    }
    if (!result.length) result.push({ title: '', lines: [] });
    result[result.length - 1]!.lines.push(line);
  }
  return { title, sections: result };
}
export function VisionPage({ back }: { back: () => void }) {
  const [doc, setDoc] = React.useState<ReturnType<typeof sections> | null>(null),
    [error, setError] = React.useState(''),
    [open, setOpen] = React.useState(0),
    [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    desk<{ markdown: string }>('/v4/presentation/vision')
      .then((d) => {
        if (live) setDoc(sections(d.markdown));
      })
      .catch(() => {
        if (live) setError('The complete-vision page could not be loaded.');
      });
    return () => {
      live = false;
    };
  }, [retry]);
  return (
    <SafeAreaView style={s.page}>
      <ScrollView contentContainerStyle={s.wrap}>
        <Button kind="quiet" label="Back to field desk" onPress={back} />
        {error ? (
          <>
            <Text style={s.body}>{error}</Text>
            <Button
              label="Retry"
              onPress={() => {
                setError('');
                setRetry((n) => n + 1);
              }}
            />
          </>
        ) : !doc ? (
          <ActivityIndicator />
        ) : (
          <>
            <Text style={s.title}>{doc.title}</Text>
            {doc.sections.map((group, i) => (
              <View key={i} style={s.section}>
                {!!group.title && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open === i }}
                    onPress={() => setOpen(open === i ? -1 : i)}
                  >
                    <Text style={s.head}>{group.title}</Text>
                  </Pressable>
                )}
                {(!group.title || open === i) &&
                  group.lines.map((line, j) =>
                    line.startsWith('|') ? (
                      <View key={j} style={s.cell}>
                        {line
                          .slice(1, -1)
                          .split('|')
                          .map((c, k) => (
                            <Text key={k} style={k === 0 ? s.label : s.body}>
                              {plain(c)}
                            </Text>
                          ))}
                      </View>
                    ) : (
                      <Text key={j} style={line.startsWith('###') ? s.head : s.body}>
                        {plain(line.replace(/^###\s*/, '').replace(/^[-*]\s+/, '• '))}
                      </Text>
                    ),
                  )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
