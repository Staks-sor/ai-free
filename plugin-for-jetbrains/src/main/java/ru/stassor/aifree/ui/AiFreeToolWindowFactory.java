package ru.stassor.aifree.ui;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBPanel;
import com.intellij.ui.content.Content;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.util.ui.JBUI;
import org.jetbrains.annotations.NotNull;
import ru.stassor.aifree.runtime.AiFreeBackendService;

import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JPanel;
import javax.swing.SwingConstants;
import java.awt.BorderLayout;
import java.awt.Desktop;
import java.awt.FlowLayout;
import java.net.URI;

public final class AiFreeToolWindowFactory implements ToolWindowFactory, DumbAware {
    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        JBPanel<?> root = new JBPanel<>(new BorderLayout());
        root.add(createStatusPanel("Запускаю AI Free..."), BorderLayout.CENTER);
        Content content = toolWindow.getContentManager().getFactory().createContent(root, null, false);
        toolWindow.getContentManager().addContent(content);

        project.getService(AiFreeBackendService.class).start().whenComplete((handle, error) ->
            ApplicationManager.getApplication().invokeLater(() -> {
                if (project.isDisposed()) return;
                root.removeAll();
                if (error != null) {
                    Throwable cause = error.getCause() != null ? error.getCause() : error;
                    root.add(createErrorPanel(messageOf(cause)), BorderLayout.CENTER);
                } else if (JBCefApp.isSupported()) {
                    JBCefBrowser browser = new JBCefBrowser(handle.getUrl());
                    Disposer.register(content, browser);
                    root.add(browser.getComponent(), BorderLayout.CENTER);
                } else {
                    root.add(createUnsupportedBrowserPanel(handle.getUrl()), BorderLayout.CENTER);
                }
                root.revalidate();
                root.repaint();
            })
        );
    }

    private static JComponent createStatusPanel(String message) {
        JBPanel<?> panel = new JBPanel<>(new BorderLayout());
        panel.setBorder(JBUI.Borders.empty(24));
        panel.add(new JBLabel(message, SwingConstants.CENTER), BorderLayout.CENTER);
        return panel;
    }

    private static JComponent createErrorPanel(String message) {
        JBPanel<?> panel = new JBPanel<>(new BorderLayout());
        panel.setBorder(JBUI.Borders.empty(24));
        JBLabel label = new JBLabel(
            "<html><b>AI Free не запустился</b><br><br>" + escapeHtml(message) + "</html>"
        );
        label.setForeground(JBColor.RED);
        panel.add(label, BorderLayout.CENTER);

        JButton details = new JButton("Показать ошибку");
        details.addActionListener(event -> Messages.showErrorDialog(message, "AI Free"));
        JPanel actions = new JPanel(new FlowLayout(FlowLayout.CENTER));
        actions.add(details);
        panel.add(actions, BorderLayout.SOUTH);
        return panel;
    }

    private static JComponent createUnsupportedBrowserPanel(String url) {
        JBPanel<?> panel = new JBPanel<>(new BorderLayout());
        panel.setBorder(JBUI.Borders.empty(24));
        panel.add(
            new JBLabel(
                "<html><b>Встроенный браузер недоступен.</b><br>" +
                    "Запустите PyCharm на JetBrains Runtime с JCEF.</html>",
                SwingConstants.CENTER
            ),
            BorderLayout.CENTER
        );
        JButton open = new JButton("Открыть AI Free");
        open.addActionListener(event -> {
            try {
                Desktop.getDesktop().browse(URI.create(url));
            } catch (Exception error) {
                Messages.showErrorDialog(messageOf(error), "AI Free");
            }
        });
        panel.add(open, BorderLayout.SOUTH);
        return panel;
    }

    private static String messageOf(Throwable error) {
        return error.getMessage() == null ? error.toString() : error.getMessage();
    }

    private static String escapeHtml(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
