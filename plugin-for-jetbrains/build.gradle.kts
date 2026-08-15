import org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

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
        name = "AI Free Chat & Agent"
        version = project.version.toString()
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
        }
        vendor {
            name = "Staks-sor"
            url = "https://github.com/Staks-sor/ai-free"
        }
        description = """
            AI Free inside PyCharm: DeepSeek, Qwen and ChatGPT chats,
            coding agents, project tools, memory, voice input and local APIs.
        """.trimIndent()
        changeNotes = "Improved Windows test reliability, closed SQLite memory handles cleanly, and hardened STT language handling against command injection."
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
        include("api/**", "bin/**", "src/**", "node_modules/**", "package.json", "LICENSE")
        exclude("plugin-for-vscode/**")
        exclude("plugin-for-jetbrains/**")
        exclude("test/**")
        exclude("node_modules/.cache/**")
        exclude("node_modules/fsevents/**")
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
