use super::*;

fn vault(pairs: &[(&str, &str)]) -> Vault {
    let mut vault = Vault::default();
    for (name, value) in pairs {
        set(&mut vault, name, value).unwrap();
    }
    vault
}

#[test]
fn names_are_what_a_shell_accepts() {
    for good in ["STRIPE_SECRET_KEY", "_PRIVATE", "NEXT_PUBLIC_URL", "a1"] {
        assert!(valid_name(good), "{good}");
    }
    for bad in ["", "1KEY", "MY-KEY", "MY KEY", "KEY=1", "ÇA", &"K".repeat(MAX_NAME + 1)] {
        assert!(!valid_name(bad), "{bad}");
    }
}

#[test]
fn setting_again_replaces_and_keeps_the_order() {
    let mut v = vault(&[("A", "1"), ("B", "2")]);
    set(&mut v, "A", "3").unwrap();
    assert_eq!(v.vars, [Var { name: "A".into(), value: "3".into() }, Var { name: "B".into(), value: "2".into() }]);
    assert!(set(&mut v, "BAD-NAME", "x").is_err());
    assert!(set(&mut v, "C", &"x".repeat(MAX_VALUE + 1)).is_err());
    assert!(set(&mut v, "C", "a\0b").is_err());
    assert!(set(&mut v, "PEM", "-----BEGIN KEY-----\nabc\n-----END KEY-----").is_ok(), "multi-line values are kept");
}

#[test]
fn a_company_keeps_a_bounded_number() {
    let mut v = Vault::default();
    for n in 0..MAX_VARS {
        set(&mut v, &format!("V{n}"), "x").unwrap();
    }
    assert!(set(&mut v, "ONE_MORE", "x").is_err());
    assert!(set(&mut v, "V0", "changed").is_ok(), "an existing one can still change");
}

#[test]
fn a_removed_variable_can_be_put_back_with_its_value() {
    let mut v = vault(&[("KEY", "kept-value-123456789")]);
    remove(&mut v, "KEY", 7).unwrap();
    assert!(v.vars.is_empty());
    assert_eq!(view(&v, "").removed, ["KEY"]);
    restore(&mut v, "KEY").unwrap();
    assert_eq!(v.vars, [Var { name: "KEY".into(), value: "kept-value-123456789".into() }]);
    assert!(view(&v, "").removed.is_empty());
    assert!(restore(&mut v, "KEY").is_err(), "nothing left to put back");
    assert!(remove(&mut v, "NOPE", 8).is_err());
}

#[test]
fn removed_values_are_held_up_to_a_limit_newest_first() {
    let mut v = Vault::default();
    for n in 0..(KEPT_REMOVED + 5) {
        set(&mut v, &format!("V{n}"), "x").unwrap();
        remove(&mut v, &format!("V{n}"), n as u64).unwrap();
    }
    assert_eq!(v.removed.len(), KEPT_REMOVED);
    assert_eq!(v.removed[0].name, format!("V{}", KEPT_REMOVED + 4));
}

#[test]
fn the_example_file_names_what_is_missing() {
    let example = "# Stripe\nSTRIPE_SECRET_KEY=\nexport NEXT_PUBLIC_URL=https://x\n  SUPABASE_URL = \nnot a line\nBAD-NAME=1\nSTRIPE_SECRET_KEY=again\n";
    assert_eq!(expected(example), ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_URL", "SUPABASE_URL"]);
    let v = vault(&[("SUPABASE_URL", "https://abc.supabase.co")]);
    assert_eq!(view(&v, example).missing, ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_URL"]);
}

#[test]
fn the_screen_sees_names_and_at_most_the_last_four_characters() {
    let v = vault(&[("LONG", "sk_test_abcdef4f2a"), ("NEXT_PUBLIC_FLAG", "open-sesame")]);
    let shown = view(&v, "");
    assert_eq!(shown.vars, [Shown { name: "LONG".into(), hint: "4f2a".into(), public: false }, Shown { name: "NEXT_PUBLIC_FLAG".into(), hint: String::new(), public: true }]);
    let json = serde_json::to_string(&shown).unwrap();
    assert!(!json.contains("sk_test") && !json.contains("sesame"), "no value goes to the screen: {json}");
}

#[test]
fn an_unreadable_item_is_never_written_over() {
    let item = format!("env-test{}", std::process::id());
    crate::secrets::save(&item, "not json").unwrap();
    assert!(load(&item).is_err());
    crate::secrets::forget(&item);
    assert_eq!(load(&item).unwrap(), Vault::default(), "no item is an empty vault");
}

#[test]
fn only_a_real_company_id_names_an_item() {
    assert_eq!(item("p18f2a").unwrap(), "env-p18f2a");
    for bad in ["", "../x", "P1", "p 1"] {
        assert!(item(bad).is_err(), "{bad}");
    }
}

#[test]
fn names_that_run_the_mac_are_refused() {
    let mut v = Vault::default();
    for name in ["PATH", "HOME", "DYLD_INSERT_LIBRARIES", "LD_PRELOAD"] {
        assert!(set(&mut v, name, "x").is_err(), "{name}");
    }
    assert_eq!(expected("PATH=\nAPI_URL=\n"), ["API_URL"]);
}

#[test]
fn a_published_build_gets_only_what_frameworks_bake_into_the_page() {
    let vars: Vars = ["NEXT_PUBLIC_URL", "VITE_KEY", "PUBLIC_SITE", "STRIPE_SECRET_KEY", "DATABASE_URL"].iter().map(|n| (n.to_string(), "v".to_string())).collect();
    let names: Vec<String> = public(vars).into_iter().map(|(n, _)| n).collect();
    assert_eq!(names, ["NEXT_PUBLIC_URL", "VITE_KEY", "PUBLIC_SITE"]);
}

#[test]
fn agents_hear_the_names_and_where_a_new_one_goes_never_a_value() {
    let note = prompt_note(&vec![("STRIPE_SECRET_KEY".into(), "sk_test_hidden".into())]);
    assert!(note.contains("STRIPE_SECRET_KEY") && note.contains(".env.example") && !note.contains("sk_test_hidden"), "{note}");
    let none = prompt_note(&Vec::new());
    assert!(none.contains("No environment variables") && none.contains(".env.example"), "{none}");
}
