import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[Milla] UI error recovered by boundary:', error, info.componentStack);
  }

  private retry = () => {
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.brand}>MILLA</Text>
        <Text style={styles.title}>La pantalla se reinicio de forma segura</Text>
        <Text style={styles.body}>
          Tu musica y tu biblioteca local siguen intactas.
        </Text>
        <TouchableOpacity accessibilityRole="button" onPress={this.retry} style={styles.button}>
          <Text style={styles.buttonText}>Volver a Milla</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#101014',
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  brand: {
    color: '#f6f4ef',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 20,
    textAlign: 'center',
  },
  body: {
    color: '#a5a5ad',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#f6f4ef',
    borderRadius: 8,
    marginTop: 28,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  buttonText: {
    color: '#17171c',
    fontSize: 15,
    fontWeight: '700',
  },
});
