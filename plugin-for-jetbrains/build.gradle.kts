import org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.gradle.jvm.tasks.Jar

plugins {
    id("org.jetbrains.kotlin.jvm") version "2.2.20"
    id("org.jetbrains.intellij.platform") version "2.18.1"
}

group = providers.gradleProperty("group").get()
version = providers.gradleProperty("version").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        pycharmCommunity(providers.gradleProperty("platformVersion")) {
            useInstaller = false
        }
        testFramework(org.jetbrains.intellij.platform.gradle.TestFrameworkType.Platform)
        pluginVerifier()
    }
    testImplementation(kotlin("test"))
    testImplementation("junit:junit:4.13.2")
}

kotlin {
    compilerOptions.jvmTarget.set(JvmTarget.JVM_21)
    jvmToolchain(21)
}

intellijPlatform {
    pluginConfiguration {
        id = "ru.stas-sor.ai-free"
        name = "SYNVOX"
        version = project.version.toString()
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
        }
        vendor {
            name = "Staks-sor"
            url = "https://github.com/Staks-sor/ai-free"
        }
        description = """
            SYNVOX brings local AI chat and coding agents to PyCharm. Use DeepSeek, Qwen,
            ChatGPT, Google AI Mode, and GLM with project tools, memory, voice input, and
            local OpenAI- and Anthropic-compatible APIs.
            SYNVOX is free for personal use. No SYNVOX activation, subscription or trial.
            Connect your AI accounts in Settings → Accounts. Provider policies and limits apply.
            Documentation and terms: https://synvox.pro/
        """.trimIndent()
        changeNotes = "SYNVOX 0.5.65 is free for personal use without activation, a subscription or trial. Adds in-app announcements. Local chats, settings and provider accounts stay available on update. AI providers retain their own sign-in and usage limits."
    }
    pluginVerification {
        ides {
            recommended()
        }
    }
    publishing {
        token = providers.environmentVariable("PUBLISH_TOKEN")
    }
    signing {
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }
}

val syncAiFreeRuntime by tasks.registering(Sync::class) {
    from(rootProject.projectDir.resolve("..")) {
        include("api/**", "bin/**", "src/**", "packages/core/**", "node_modules/**", "package.json", "LICENSE")
        exclude("plugin-for-vscode/**")
        exclude("plugin-for-jetbrains/**")
        exclude("test/**")
        exclude("api/README.md")
        exclude(".env", ".env.*", "**/.env", "**/.env.*", "**/.npmrc")
        exclude { it.file.extension == "pem" && it.file.name != "merchant-public.pem" }
        exclude("**/*.key", "**/*.p12", "**/*.pfx")
        exclude("**/credentials.json", "**/cookies.json")
        exclude("**/.git/**", "**/.github/**", "**/.idea/**", "**/.vscode/**")
        exclude("**/.playwright-cli/**", "**/coverage/**", "output/**")
        exclude("node_modules/.cache/**")
        exclude("node_modules/.package-lock.json")
        exclude("node_modules/fsevents/**")
        exclude("node_modules/**/.git/**", "node_modules/**/.github/**")
        exclude("node_modules/**/test/**", "node_modules/**/tests/**", "node_modules/**/__tests__/**", "node_modules/**/coverage/**")
        exclude("node_modules/**/*.map")
        exclude("**/.DS_Store")
    }
    into(layout.buildDirectory.dir("ai-free-runtime"))
}

tasks.withType<PrepareSandboxTask>().configureEach {
    dependsOn(syncAiFreeRuntime)
    from(syncAiFreeRuntime) {
        into("${project.name}/runtime")
    }
}

tasks.test {
    useJUnitPlatform()
}

tasks.withType<Jar>().configureEach {
    manifest.attributes["Implementation-Version"] = project.version.toString()
}
